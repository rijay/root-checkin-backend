#!/usr/bin/env node

const SOURCE_ALIASES = {
  ORDER: "YOUZAN_ORDER",
  YOUZAN: "YOUZAN_ORDER",
  YOUZAN_ORDER: "YOUZAN_ORDER",
  FULFILLMENT: "FULFILLMENT",
  LOGISTICS: "FULFILLMENT",
  WECHAT: "WECHAT_LEAD",
  WECHAT_LEAD: "WECHAT_LEAD",
  WEWORK: "WECHAT_LEAD",
  WEWORK_CONTACT: "WECHAT_LEAD",
};

const DEFAULT_ADAPTER_BY_SOURCE = {
  YOUZAN_ORDER: "YOUZAN_OPEN",
  FULFILLMENT: "FULFILLMENT_PUSH",
  WECHAT_LEAD: "WEWORK_CONTACT",
};

function normalizeSource(value) {
  const key = String(value || "YOUZAN_ORDER").trim().toUpperCase();
  return SOURCE_ALIASES[key] || key;
}

function normalizeMode(value) {
  return String(value || "preview").toLowerCase() === "import" ? "IMPORT" : "PREVIEW";
}

function parseArgs(argv) {
  const sourceType = normalizeSource("YOUZAN_ORDER");
  const args = {
    baseUrl: process.env.ROOT_CALIBRATION_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`,
    sourceType,
    adapterKind: DEFAULT_ADAPTER_BY_SOURCE[sourceType],
    mode: "PREVIEW",
    limit: 1,
    cursor: "",
    commitCursor: false,
    json: false,
    allowFailed: false,
    allowErrors: false,
  };
  let adapterProvided = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--source") args.sourceType = normalizeSource(argv[index += 1]);
    else if (item === "--adapter") {
      args.adapterKind = String(argv[index += 1] || "").trim().toUpperCase();
      adapterProvided = true;
    }
    else if (item === "--mode") args.mode = normalizeMode(argv[index += 1]);
    else if (item === "--limit") args.limit = Math.max(1, Number(argv[index += 1] || 1));
    else if (item === "--cursor") args.cursor = argv[index += 1] || "";
    else if (item === "--commit-cursor") args.commitCursor = true;
    else if (item === "--json") args.json = true;
    else if (item === "--allow-failed") args.allowFailed = true;
    else if (item === "--allow-errors") args.allowErrors = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!adapterProvided) args.adapterKind = DEFAULT_ADAPTER_BY_SOURCE[args.sourceType] || "";
  return args;
}

async function fetchPayload(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  return { ok: response.ok && payload.code === 0, status: response.status, payload };
}

async function fetchJson(baseUrl, route) {
  const response = await fetchPayload(baseUrl, route);
  if (!response.ok) {
    throw new Error(response.payload.message || `请求失败：${response.status}`);
  }
  return response.payload.data;
}

function requestBody(args) {
  return {
    sourceType: args.sourceType,
    adapterKind: args.adapterKind,
    mode: args.mode,
    limit: args.limit,
    cursor: args.cursor || undefined,
    commitCursor: args.commitCursor || undefined,
  };
}

function latestRun(externalAdapters, sourceType, adapterKind) {
  return (externalAdapters.runs || []).find((run) => {
    return run.source_type === sourceType && run.adapter_kind === adapterKind;
  }) || null;
}

async function collectAdapterRun(args) {
  const body = requestBody(args);
  const runResponse = await fetchPayload(args.baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const externalAdapters = await fetchJson(args.baseUrl, "/api/v1/admin/external-adapters");
  const adapterCalibration = await fetchJson(args.baseUrl, "/api/v1/admin/adapter-calibration");
  return {
    request: body,
    ok: runResponse.ok,
    code: runResponse.payload.code,
    message: runResponse.payload.message,
    result: runResponse.ok ? runResponse.payload.data : null,
    latestRun: latestRun(externalAdapters, body.sourceType, body.adapterKind),
    externalAdapters,
    adapterCalibration,
  };
}

function runSummaryLines(bundle) {
  const run = bundle.result ? bundle.result.run : bundle.latestRun;
  if (!run) return ["- 暂无运行记录"];
  return [
    `- 运行 ID：${run.run_id || "-"}`,
    `- 状态：${run.status || "-"}`,
    `- 外部数量：${run.external_count || 0}`,
    `- 样本数量：${run.total || 0}`,
    `- 可导入：${run.importable_count || 0}`,
    `- 已导入：${run.imported_count || 0}`,
    `- 错误：${run.error_count || 0}`,
    `- 提醒：${run.warning_count || 0}`,
    `- 游标：${run.cursor_before || ""} -> ${run.cursor_after || ""}`,
    `- 错误信息：${run.error_message || "无"}`,
  ];
}

function calibrationLine(bundle) {
  const source = (bundle.adapterCalibration.sources || []).find((item) => {
    return item.sourceType === bundle.request.sourceType && item.adapterKind === bundle.request.adapterKind;
  });
  if (!source) return "- 未找到 Adapter 校准结果";
  return `- ${source.label} / ${source.adapterKind}: ${source.status}，阻塞 ${source.summary.blockers}，提醒 ${source.summary.warnings}`;
}

function buildAdapterRunReport(bundle) {
  const result = bundle.result ? bundle.result.result : null;
  const review = bundle.result ? bundle.result.review : null;
  const lines = [
    "# ROOT 真实 Adapter 运行报告",
    "",
    `来源：${bundle.request.sourceType}`,
    `Adapter：${bundle.request.adapterKind}`,
    `模式：${bundle.request.mode}`,
    `limit：${bundle.request.limit}`,
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    "",
    "## 运行结果",
    ...runSummaryLines(bundle),
    "",
    "## 样本结果",
    result
      ? `- 样本 ${result.total || 0}，可导入 ${result.importableCount || 0}，已导入 ${result.importedCount || 0}，错误 ${result.errorCount || 0}，提醒 ${result.warningCount || 0}`
      : "- 本次未返回样本结果",
    review ? `- 评审：${review.decision_status}` : "- 评审：无",
    "",
    "## Adapter 校准",
    calibrationLine(bundle),
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(bundle, args = {}) {
  if (args.allowFailed) return 0;
  if (!bundle.ok) return 2;
  const run = bundle.result ? bundle.result.run : bundle.latestRun;
  if (run && run.status === "FAILED") return 2;
  const result = bundle.result ? bundle.result.result : null;
  if (!args.allowErrors && result && (result.errorCount || 0) > 0) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectAdapterRun(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildAdapterRunReport(bundle));
    }
    process.exitCode = determineExitCode(bundle, args);
  } catch (error) {
    process.stderr.write(`Adapter 运行失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAdapterRunReport,
  collectAdapterRun,
  determineExitCode,
  normalizeSource,
  parseArgs,
};
