const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/app");
const { createJsonFileStore, createSqliteStore } = require("../src/store");
const { buildCalibrationReport, determineExitCode } = require("../scripts/release-calibration");
const { buildSampleCalibrationReport, determineExitCode: determineSampleExitCode } = require("../scripts/sample-calibration");
const {
  buildAdapterRunReport,
  collectAdapterRun,
  determineExitCode: determineAdapterExitCode,
  normalizeSource,
  parseArgs: parseAdapterArgs,
} = require("../scripts/adapter-runner");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

async function textRequest(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: await response.text(),
  };
}

test("serves the REST API and admin dashboard data", async (t) => {
  const server = createApp();
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const home = await textRequest(baseUrl, "/");
  assert.equal(home.status, 200);
  assert.match(home.contentType, /text\/html/);
  assert.match(home.body, /ROOT 7日打卡后台/);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  const token = login.data.token;

  assert.equal(login.code, 0);
  assert.equal(login.data.user.state, "UNREGISTERED");

  const profile = await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  assert.equal(profile.data.user.state, "REGISTERED_IDLE");

  const audit = await request(baseUrl, "/api/v1/jobs/daily-audit", {
    method: "POST",
    body: JSON.stringify({ date: "2026-04-27" }),
  });
  assert.equal(audit.code, 0);
  assert.equal(audit.data.summary.date, "2026-04-27");

  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");
  assert.equal(dashboard.code, 0);
  assert.equal(dashboard.data.metrics.users, 1);
  assert.equal(dashboard.data.summary.date, "2026-04-27");
  assert.equal(dashboard.data.launchReadiness.status, "BLOCKED");

  const readiness = await request(baseUrl, "/api/v1/admin/launch-readiness?target=production");
  assert.equal(readiness.code, 0);
  assert.equal(readiness.data.target, "production");
  assert.equal(readiness.data.status, "BLOCKED");
  assert.ok(readiness.data.checks.some((item) => item.id === "store_adapter" && item.status === "BLOCKER"));

  const releaseRecord = await request(baseUrl, "/api/v1/admin/release-record?target=gray");
  assert.equal(releaseRecord.code, 0);
  assert.equal(releaseRecord.data.target, "gray");
  assert.equal(releaseRecord.data.status, "BLOCKED");
  assert.ok(releaseRecord.data.evidence.launchReadiness.summary.total > 0);
  assert.ok(releaseRecord.data.rollback.some((item) => item.includes("MANUAL_SAMPLE")));

  const calibration = await request(baseUrl, "/api/v1/admin/adapter-calibration");
  const adapters = await request(baseUrl, "/api/v1/admin/external-adapters");
  const calibrationReport = buildCalibrationReport({
    releaseRecord: releaseRecord.data,
    adapterCalibration: calibration.data,
    launchReadiness: readiness.data,
    externalAdapters: adapters.data,
  });
  assert.match(calibrationReport, /ROOT 7日打卡发布记录/);
  assert.match(calibrationReport, /Adapter 校准/);
  assert.equal(determineExitCode(releaseRecord.data), 2);
  assert.equal(determineExitCode(releaseRecord.data, { allowBlocked: true }), 0);

  const template = await request(baseUrl, "/api/v1/admin/external-samples/template?sourceType=FULFILLMENT");
  assert.equal(template.code, 0);
  assert.equal(template.data.sourceType, "FULFILLMENT");
  assert.equal(template.data.requiredSamples, 3);
  assert.match(template.data.csvHeader, /有赞订单号/);

  const detail = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/detail`);
  assert.equal(detail.code, 0);
  assert.equal(detail.data.user.userId, login.data.user.userId);
  assert.deepEqual(detail.data.feedbacks, []);

  const follow = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/follow`, {
    method: "POST",
    body: JSON.stringify({ sourceType: "MANUAL", sourceId: "api-test", reason: "人工跟进测试" }),
  });
  assert.equal(follow.code, 0);
  assert.equal(follow.data.task.taskType, "FEEDBACK_FOLLOW");
});

test("external platform adapter Interface exposes catalog and manual sample runs", async (t) => {
  const server = createApp({ env: {} });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const catalog = await request(baseUrl, "/api/v1/admin/external-adapters");
  assert.equal(catalog.code, 0);
  assert.ok(catalog.data.catalog.manualAdapters.some((item) => item.sourceType === "YOUZAN_ORDER" && item.status === "READY"));
  assert.ok(catalog.data.catalog.realAdapters.some((item) => item.adapterKind === "YOUZAN_OPEN" && item.status === "NEEDS_CONFIG"));

  const calibration = await request(baseUrl, "/api/v1/admin/adapter-calibration");
  assert.equal(calibration.code, 0);
  assert.equal(calibration.data.sources.length, 3);
  assert.ok(calibration.data.sources.some((item) => item.adapterKind === "YOUZAN_OPEN"));
  assert.equal(normalizeSource("wework"), "WECHAT_LEAD");
  assert.equal(parseAdapterArgs(["--source", "wework"]).adapterKind, "WEWORK_CONTACT");
  assert.equal(parseAdapterArgs(["--source", "fulfillment"]).adapterKind, "FULFILLMENT_PUSH");

  const failedRun = await collectAdapterRun({
    baseUrl,
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "PREVIEW",
    limit: 1,
  });
  const failedRunReport = buildAdapterRunReport(failedRun);
  assert.equal(failedRun.ok, false);
  assert.match(failedRun.message, /未配置/);
  assert.equal(failedRun.latestRun.status, "FAILED");
  assert.equal(determineAdapterExitCode(failedRun), 2);
  assert.match(failedRunReport, /ROOT 真实 Adapter 运行报告/);

  const run = await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "PREVIEW",
      text: [
        "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
        "YZROOT202605170001,赵样本,13800017001,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址",
      ].join("\n"),
    }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");

  assert.equal(run.code, 0);
  assert.equal(run.data.run.adapter_kind, "MANUAL_SAMPLE");
  assert.equal(run.data.run.mode, "PREVIEW");
  assert.equal(run.data.result.importableCount, 1);
  assert.equal(run.data.review.mode, "ADAPTER_PREVIEW");
  assert.equal(dashboard.data.externalAdapterRuns[0].review_id, run.data.review.review_id);
});

test("sample calibration report summarizes file previews and readiness", async (t) => {
  const server = createApp({ env: {} });
  const baseUrl = await listen(server);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-samples-"));
  const youzanFile = path.join(tempDir, "youzan.csv");
  t.after(() => server.close());

  fs.writeFileSync(youzanFile, [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605180001,样本一,13800018001,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1",
    "YZROOT202605180002,样本二,13800018002,ROOT 7日试饮装,199,已支付,已签收,上海市样本地址2",
    "YZROOT202605180003,样本三,13800018003,ROOT 7日试饮装,199,已支付,运输中,上海市样本地址3",
  ].join("\n"));

  const preview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text: fs.readFileSync(youzanFile, "utf8") }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");
  const bundle = {
    mode: "preview",
    generatedAt: "2026-05-16T00:00:00.000Z",
    results: [{
      sourceType: "YOUZAN_ORDER",
      label: "有赞订单",
      filePath: youzanFile,
      mode: "preview",
      result: preview.data,
    }],
    adapterReadiness: dashboard.data.externalAdapterReadiness,
    adapterCalibration: dashboard.data.adapterCalibration,
  };
  const report = buildSampleCalibrationReport(bundle);

  assert.equal(preview.data.errorCount, 0);
  assert.equal(preview.data.review.decision_status, "READY");
  assert.match(report, /ROOT 真实样本准入报告/);
  assert.match(report, /有赞订单: PREVIEW/);
  assert.equal(determineSampleExitCode(bundle), 0);
  assert.equal(determineSampleExitCode(bundle, { requireAllReady: true }), 2);
});

test("JSON file store persists HTTP mutations across app restarts", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-store-"));
  const storePath = path.join(tempDir, "store.json");
  const firstStore = createJsonFileStore(storePath);
  const server = createApp({ storeAdapter: firstStore });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  const token = login.data.token;
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });

  const reloadedStore = createJsonFileStore(storePath);
  const user = reloadedStore.data.users.find((item) => item.phone === "13800000001");

  assert.ok(fs.existsSync(storePath));
  assert.equal(user.state, "REGISTERED_IDLE");
  assert.equal(reloadedStore.kind, "json-file");
});

test("SQLite store persists HTTP mutations across app restarts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-sqlite-store-"));
  const storePath = path.join(tempDir, "store.sqlite");
  const firstStore = createSqliteStore(storePath);
  const server = createApp({ storeAdapter: firstStore });
  const baseUrl = await listen(server);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000002" }),
  });
  const token = login.data.token;
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  await new Promise((resolve) => server.close(resolve));
  firstStore.close();

  const reloadedStore = createSqliteStore(storePath);
  const user = reloadedStore.data.users.find((item) => item.phone === "13800000002");

  assert.ok(fs.existsSync(storePath));
  assert.equal(user.state, "REGISTERED_IDLE");
  assert.equal(reloadedStore.kind, "sqlite");
  reloadedStore.close();
});
