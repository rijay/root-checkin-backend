#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SOURCES = [
  { sourceType: "YOUZAN_ORDER", label: "有赞订单", arg: "youzanFile" },
  { sourceType: "FULFILLMENT", label: "物流状态", arg: "fulfillmentFile" },
  { sourceType: "WECHAT_LEAD", label: "企业微信线索", arg: "weworkFile" },
];

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ROOT_CALIBRATION_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`,
    mode: "preview",
    json: false,
    strict: false,
    requireAllReady: false,
    allowBlocked: false,
    youzanFile: "",
    fulfillmentFile: "",
    weworkFile: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--mode") args.mode = argv[index += 1] || args.mode;
    else if (item === "--youzan-file") args.youzanFile = argv[index += 1] || "";
    else if (item === "--fulfillment-file") args.fulfillmentFile = argv[index += 1] || "";
    else if (item === "--wework-file") args.weworkFile = argv[index += 1] || "";
    else if (item === "--json") args.json = true;
    else if (item === "--strict") args.strict = true;
    else if (item === "--require-all-ready") args.requireAllReady = true;
    else if (item === "--allow-blocked") args.allowBlocked = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  args.mode = String(args.mode || "").toLowerCase() === "import" ? "import" : "preview";
  return args;
}

function selectedSources(args) {
  return SOURCES
    .map((source) => ({ ...source, filePath: args[source.arg] }))
    .filter((source) => source.filePath);
}

function readTextFile(filePath) {
  const absolutePath = path.resolve(filePath);
  return {
    absolutePath,
    text: fs.readFileSync(absolutePath, "utf8"),
  };
}

async function fetchJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload.data;
}

async function submitSample(baseUrl, source, mode) {
  const file = readTextFile(source.filePath);
  const route = mode === "import"
    ? "/api/v1/admin/external-samples/import"
    : "/api/v1/admin/external-samples/preview";
  const result = await fetchJson(baseUrl, route, {
    method: "POST",
    body: JSON.stringify({ sourceType: source.sourceType, text: file.text }),
  });
  return {
    sourceType: source.sourceType,
    label: source.label,
    filePath: file.absolutePath,
    mode,
    result,
  };
}

async function collectSampleCalibration(args) {
  const sources = selectedSources(args);
  if (!sources.length) {
    throw new Error("请至少提供一个样本文件：--youzan-file、--fulfillment-file 或 --wework-file");
  }
  const results = [];
  for (const source of sources) {
    results.push(await submitSample(args.baseUrl, source, args.mode));
  }
  const dashboard = await fetchJson(args.baseUrl, "/api/v1/admin/dashboard");
  const calibration = await fetchJson(args.baseUrl, "/api/v1/admin/adapter-calibration");
  return {
    mode: args.mode,
    generatedAt: new Date().toISOString(),
    results,
    adapterReadiness: dashboard.externalAdapterReadiness,
    adapterCalibration: calibration,
  };
}

function resultLines(results) {
  return results.flatMap((item) => {
    const result = item.result || {};
    const review = result.review || {};
    const lines = [
      `- ${item.label}: ${item.mode.toUpperCase()}，样本 ${result.total || 0}，可导入 ${result.importableCount || 0}，已导入 ${result.importedCount || 0}，错误 ${result.errorCount || 0}，提醒 ${result.warningCount || 0}`,
      `  - 文件：${item.filePath}`,
      `  - 评审：${review.decision_status || "UNKNOWN"}`,
    ];
    const failedRows = (result.rows || []).filter((row) => row.errors && row.errors.length).slice(0, 5);
    failedRows.forEach((row) => {
      lines.push(`  - 第 ${row.index} 行：${row.errors.join("；")}`);
    });
    return lines;
  });
}

function readinessLines(adapterReadiness = {}) {
  return (adapterReadiness.sources || []).map((source) => {
    const reasons = (source.blockingReasons || []).map((item) => item.message).join("；") || "无阻塞";
    const warnings = (source.warnings || []).map((item) => item.message).join("；") || "无提醒";
    return `- ${source.label}: ${source.status}，${reasons}，${warnings}`;
  });
}

function buildSampleCalibrationReport(bundle) {
  const readiness = bundle.adapterReadiness || {};
  const lines = [
    "# ROOT 真实样本准入报告",
    "",
    `模式：${bundle.mode.toUpperCase()}`,
    `生成时间：${bundle.generatedAt}`,
    "",
    "## 本次样本",
    ...resultLines(bundle.results),
    "",
    "## Adapter 准入",
    `- 状态：${readiness.status || "UNKNOWN"}`,
    `- READY：${readiness.summary ? readiness.summary.ready : 0}`,
    `- NEEDS_REVIEW：${readiness.summary ? readiness.summary.needsReview : 0}`,
    `- BLOCKED：${readiness.summary ? readiness.summary.blocked : 0}`,
    ...readinessLines(readiness),
  ];
  return `${lines.join("\n")}\n`;
}

function hasResultBlocker(bundle) {
  return (bundle.results || []).some((item) => {
    const result = item.result || {};
    const review = result.review || {};
    return (result.errorCount || 0) > 0 || review.decision_status === "BLOCKED" || review.decision_status === "NEEDS_MAPPING";
  });
}

function determineExitCode(bundle, args = {}) {
  if (args.allowBlocked) return 0;
  if (hasResultBlocker(bundle)) return 2;
  const readiness = bundle.adapterReadiness || {};
  if (args.requireAllReady && readiness.status === "BLOCKED") return 2;
  if (args.strict && (readiness.status === "NEEDS_REVIEW" || (args.requireAllReady && readiness.status !== "READY"))) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectSampleCalibration(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildSampleCalibrationReport(bundle));
    }
    process.exitCode = determineExitCode(bundle, args);
  } catch (error) {
    process.stderr.write(`样本准入失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSampleCalibrationReport,
  collectSampleCalibration,
  determineExitCode,
  parseArgs,
  selectedSources,
};
