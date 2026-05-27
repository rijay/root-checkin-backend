const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/app");
const { shouldUseMysql } = require("../src/server");
const { createJsonFileStore, createSqliteStore, mysqlConfigFromEnv, validateSnapshot } = require("../src/store");
const { parseArgs: parseStoreVerifyArgs } = require("../scripts/store-verify");
const { parseArgs: parseStoreMigrateArgs } = require("../scripts/store-migrate");
const { buildCalibrationReport, determineExitCode } = require("../scripts/release-calibration");
const { buildSampleCalibrationReport, determineExitCode: determineSampleExitCode } = require("../scripts/sample-calibration");
const {
  buildAdapterRunReport,
  collectAdapterRun,
  determineExitCode: determineAdapterExitCode,
  normalizeSource,
  parseArgs: parseAdapterArgs,
} = require("../scripts/adapter-runner");

const directPhoneLoginEnv = { ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true" };

test("cloud hosting MySQL variables select the MySQL Store Adapter", () => {
  const env = {
    MYSQL_ADDRESS: "10.11.103.164:3306",
    MYSQL_USERNAME: "root",
    MYSQL_PASSWORD: "secret",
  };

  assert.equal(shouldUseMysql(env), true);
  assert.deepEqual(mysqlConfigFromEnv(env), {
    host: "10.11.103.164",
    port: 3306,
    user: "root",
    password: "secret",
    database: "root_checkin",
  });
  assert.equal(shouldUseMysql({ ...env, ROOT_STORE_ADAPTER: "sqlite" }), false);
  assert.equal(shouldUseMysql({ ROOT_STORE_ADAPTER: "mysql" }), true);
});

test("store snapshot validation catches missing keys and script arguments", () => {
  const valid = validateSnapshot(createJsonFileStore(path.join(os.tmpdir(), `root-store-${Date.now()}.json`), { seedSampleData: false }).exportSnapshot());
  const invalid = validateSnapshot({ users: [] });

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((item) => item.includes("missing key")));
  assert.deepEqual(parseStoreVerifyArgs(["--sqlite", "/tmp/root.sqlite"]), { mode: "sqlite", filePath: "/tmp/root.sqlite" });
  assert.deepEqual(parseStoreMigrateArgs(["--json", "/tmp/root.json", "--dry-run"]), { mode: "json", filePath: "/tmp/root.json", dryRun: true });
});

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
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const home = await textRequest(baseUrl, "/");
  assert.equal(home.status, 200);
  assert.match(home.contentType, /text\/html/);
  assert.match(home.body, /ROOT 7日打卡后台/);
  assert.match(home.body, /id="bulk-order-file"/);
  assert.match(home.body, /上传有赞 CSV 文件/);
  assert.match(home.body, /id="fulfillment-file"/);
  assert.match(home.body, /上传物流 CSV 文件/);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  const token = login.data.token;

  assert.equal(login.code, 0);
  assert.equal(login.data.user.state, "UNREGISTERED");

  const displayProfile = await request(baseUrl, "/api/v1/user/display-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nickname: "Root体验同学",
      avatarUrl: "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg",
    }),
  });
  assert.equal(displayProfile.data.user.nickname, "Root体验同学");
  assert.equal(displayProfile.data.user.avatarUrl, "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg");

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
  assert.equal(Array.isArray(dashboard.data.opsUsers), true);
  assert.equal(dashboard.data.opsUsers[0].currentBlockage, "已送达未开始");

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
  assert.match(template.data.csvHeader, /订单号/);

  const detail = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/detail`);
  assert.equal(detail.code, 0);
  assert.equal(detail.data.user.userId, login.data.user.userId);
  assert.equal(detail.data.opsSummary.currentBlockage, "已送达未开始");
  assert.deepEqual(detail.data.feedbacks, []);

  const follow = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/follow`, {
    method: "POST",
    body: JSON.stringify({ sourceType: "MANUAL", sourceId: "api-test", reason: "人工跟进测试" }),
  });
  assert.equal(follow.code, 0);
  assert.equal(follow.data.task.taskType, "FEEDBACK_FOLLOW");
});

test("admin data routes require the configured admin token", async (t) => {
  const server = createApp({
    env: {
      ...directPhoneLoginEnv,
      ROOT_ADMIN_TOKEN: "admin-secret",
      ROOT_ADMIN_TOKENS: JSON.stringify({ ops: { token: "ops-secret", role: "operator" } }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const denied = await request(baseUrl, "/api/v1/admin/dashboard");
  assert.equal(denied.code, 40101);

  const allowed = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-Admin-Token": "admin-secret" },
  });
  assert.equal(allowed.code, 0);
  assert.equal(typeof allowed.data.metrics.users, "number");
  const allowedByRootHeader = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-ROOT-ADMIN-TOKEN": "admin-secret" },
  });
  assert.equal(allowedByRootHeader.code, 0);
  const allowedByOperator = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-ROOT-ADMIN-TOKEN": "ops-secret" },
  });
  assert.equal(allowedByOperator.code, 0);

  const jobDenied = await request(baseUrl, "/api/v1/jobs/daily-audit", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(jobDenied.code, 40101);
});

test("cloud container login uses WeChat cloud open Interface", async (t) => {
  let requestedPath = "";
  let requestedBody = "";
  const wechatServer = http.createServer((req, res) => {
    requestedPath = req.url;
    req.on("data", (chunk) => {
      requestedBody += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        phone_info: {
          phoneNumber: "13800000009",
          purePhoneNumber: "13800000009",
        },
      }));
    });
  });
  const wechatBaseUrl = await listen(wechatServer);
  t.after(() => wechatServer.close());

  const server = createApp({ env: { ROOT_WECHAT_OPENAPI_BASE_URL: wechatBaseUrl } });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-wx-openid": "cloud_openid", "x-wx-unionid": "cloud_unionid" },
    body: JSON.stringify({ phoneCode: "phone_code" }),
  });

  assert.equal(login.code, 0);
  assert.equal(login.data.user.phone, "138****0009");
  assert.equal(requestedPath, "/wxa/business/getuserphonenumber");
  assert.deepEqual(JSON.parse(requestedBody), { code: "phone_code" });
});

test("HTTP login rejects direct phone payload when direct phone login is not enabled", async (t) => {
  const server = createApp();
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });

  assert.equal(login.code, 1007);
  assert.match(login.message, /微信手机号授权/);
});

test("admin order matching HTTP Interface searches, previews, and confirms", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.data.token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });

  const search = await request(baseUrl, "/api/v1/admin/order-matching/search?q=YZROOT202604260001");
  const preview = await request(baseUrl, "/api/v1/admin/order-matching/preview", {
    method: "POST",
    body: JSON.stringify({ orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const confirmed = await request(baseUrl, "/api/v1/admin/order-matching/confirm", {
    method: "POST",
    body: JSON.stringify({ orderId: "ord_root_001", userId: login.data.user.userId }),
  });

  assert.equal(search.code, 0);
  assert.equal(search.data.orders[0].youzanOrderNo, "YZROOT202604260001");
  assert.equal(preview.code, 0);
  assert.equal(preview.data.canConfirm, true);
  assert.equal(confirmed.code, 0);
  assert.equal(confirmed.data.order.userId, login.data.user.userId);
  assert.equal(confirmed.data.task.task_type, "DELIVERED_NOT_STARTED");
});

test("admin bulk order paste previews and imports orders into matching queue", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const text = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605250001,批量用户,13800025001,ROOT 7日试饮装,199,已支付,已发货,上海市批量地址",
    "YZROOT202605250002,缺手机号用户,,ROOT 7日试饮装,199,已支付,已发货,上海市批量地址2",
  ].join("\n");

  const preview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text }),
  });
  const imported = await request(baseUrl, "/api/v1/admin/external-samples/import", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");

  assert.equal(preview.code, 0);
  assert.equal(preview.data.total, 2);
  assert.equal(preview.data.importableCount, 1);
  assert.equal(preview.data.errorCount, 1);
  assert.equal(imported.data.importedCount, 1);
  assert.ok(dashboard.data.opsDashboard.pendingOrders.some((order) => order.youzanOrderNo === "YZROOT202605250001"));

  const rawYouzanExport = [
    "订单号,订单状态,全部商品名称,订单实付金额,买家付款时间,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
    "E20260525220543065306159,已发货,LinkVital益生元饮 7天身体重启计划(1件),99.00,2026-05-25 22:05:57,Alex,13811611060,北京市北京市西城区北京市金泰鑫桥大厦 608",
  ].join("\n");
  const rawPreview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text: rawYouzanExport }),
  });
  assert.equal(rawPreview.code, 0);
  assert.equal(rawPreview.data.importableCount, 1);
  assert.equal(rawPreview.data.rows[0].mapped.youzanOrderNo, "E20260525220543065306159");
  assert.equal(rawPreview.data.rows[0].mapped.receiverPhone, "13811611060");
  assert.equal(rawPreview.data.rows[0].mapped.deliveryStatus, "SHIPPED");
});

test("admin CSV import batches preview, confirm once, and expose batch detail", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const text = [
    "订单号,订单状态,订单实付金额,全部商品名称,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
    "YZROOT202605280001,待发货,199,ROOT 7日试饮装,批次用户,13800028001,批次地址",
    "YZROOT202605280002,待发货,199,ROOT 7日试饮装,缺手机号,,批次地址",
  ].join("\n");

  const preview = await request(baseUrl, "/api/v1/admin/imports/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text, fileName: "youzan.csv" }),
  });
  const beforeConfirm = await request(baseUrl, "/api/v1/admin/dashboard");
  const confirmed = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const confirmedAgain = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const failureCsv = await textRequest(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/failures.csv`);
  const detail = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}`);
  const afterConfirm = await request(baseUrl, "/api/v1/admin/dashboard");
  const fulfillmentText = [
    "快递公司,获取时间,电子面单号,订单号,运输状态,收件人姓名,收件人联系方式",
    "顺丰速运,2026-05-28 19:00:00,SF202605280001,YZROOT202605280001,已签收,批次用户,13800028001",
  ].join("\n");
  const fulfillmentPreview = await request(baseUrl, "/api/v1/admin/imports/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "FULFILLMENT", text: fulfillmentText, fileName: "fulfillment.csv" }),
  });
  const fulfillmentConfirmed = await request(baseUrl, `/api/v1/admin/imports/${fulfillmentPreview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const afterFulfillment = await request(baseUrl, "/api/v1/admin/dashboard");

  assert.equal(preview.code, 0);
  assert.match(preview.data.batchId, /^imp_/);
  assert.match(preview.data.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.data.preview.importableCount, 1);
  assert.equal(preview.data.preview.errorCount, 1);
  assert.equal(beforeConfirm.data.orders.some((order) => order.youzanOrderNo === "YZROOT202605280001"), false);
  assert.equal(confirmed.data.status, "CONFIRMED");
  assert.equal(confirmed.data.result.importedCount, 1);
  assert.equal(confirmedAgain.data.result.importedCount, 1);
  assert.match(failureCsv.contentType, /text\/csv/);
  assert.match(failureCsv.body, /receiverPhone/);
  assert.match(failureCsv.body, /缺手机号/);
  assert.equal(detail.data.batchId, preview.data.batchId);
  assert.equal(afterConfirm.data.orders.some((order) => order.youzanOrderNo === "YZROOT202605280001"), true);
  assert.equal(afterConfirm.data.importBatches[0].batchId, preview.data.batchId);
  assert.equal(fulfillmentPreview.data.preview.importableCount, 1);
  assert.equal(fulfillmentConfirmed.data.result.importedCount, 1);
  assert.equal(
    afterFulfillment.data.orders.find((order) => order.youzanOrderNo === "YZROOT202605280001").deliveryStatus,
    "DELIVERED"
  );
  assert.equal(
    afterFulfillment.data.orders.find((order) => order.youzanOrderNo === "YZROOT202605280001").deliveryStatusLabel,
    "已送达"
  );
  assert.equal(afterFulfillment.data.importBatches[0].batchId, fulfillmentPreview.data.batchId);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800028001" }),
  });
  const userOrders = await request(baseUrl, "/api/v1/user/orders", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  assert.equal(userOrders.data.orders[0].fulfillment.carrier, "顺丰速运");
  assert.equal(userOrders.data.orders[0].fulfillment.trackingNo, "SF202605280001");
});

test("admin correction HTTP Interface previews, applies, and lists audit logs", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000002" }),
  });

  const preview = await request(baseUrl, "/api/v1/admin/corrections/preview", {
    method: "POST",
    body: JSON.stringify({ action: "BIND_ORDER_USER", orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const denied = await request(baseUrl, "/api/v1/admin/corrections/apply", {
    method: "POST",
    body: JSON.stringify({ action: "BIND_ORDER_USER", orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const applied = await request(baseUrl, "/api/v1/admin/corrections/apply", {
    method: "POST",
    body: JSON.stringify({
      action: "BIND_ORDER_USER",
      orderId: "ord_root_001",
      userId: login.data.user.userId,
      reason: "HTTP修正测试",
      confirmRisk: true,
      operatorId: "ops-http",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?targetType=ORDER&targetId=ord_root_001");

  assert.equal(preview.code, 0);
  assert.equal(preview.data.requiresSecondConfirm, true);
  assert.equal(denied.code, 4206);
  assert.equal(applied.code, 0);
  assert.equal(applied.data.audit.action, "BIND_ORDER_USER");
  assert.equal(audit.data.auditLogs[0].operator_id, "ops-http");
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
  const server = createApp({ storeAdapter: firstStore, env: directPhoneLoginEnv });
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
  const server = createApp({ storeAdapter: firstStore, env: directPhoneLoginEnv });
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
