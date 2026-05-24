#!/usr/bin/env node

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ROOT_CALIBRATION_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`,
    target: "production",
    json: false,
    strict: false,
    allowBlocked: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--target") args.target = argv[index += 1] || args.target;
    else if (item === "--json") args.json = true;
    else if (item === "--strict") args.strict = true;
    else if (item === "--allow-blocked") args.allowBlocked = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  args.target = args.target === "gray" ? "gray" : "production";
  return args;
}

async function fetchJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload.data;
}

async function collectCalibration(args) {
  const target = encodeURIComponent(args.target);
  const [releaseRecord, adapterCalibration, launchReadiness, externalAdapters] = await Promise.all([
    fetchJson(args.baseUrl, `/api/v1/admin/release-record?target=${target}`),
    fetchJson(args.baseUrl, "/api/v1/admin/adapter-calibration"),
    fetchJson(args.baseUrl, `/api/v1/admin/launch-readiness?target=${target}`),
    fetchJson(args.baseUrl, "/api/v1/admin/external-adapters"),
  ]);
  return { releaseRecord, adapterCalibration, launchReadiness, externalAdapters };
}

function formatList(items, fallback) {
  if (!items || !items.length) return [`- ${fallback}`];
  return items.map((item) => `- ${item}`);
}

function missingEnvLines(releaseRecord) {
  return (releaseRecord.evidence.env || [])
    .filter((item) => !item.present)
    .map((item) => `- ${item.name}`);
}

function adapterLines(adapterCalibration) {
  return (adapterCalibration.sources || []).map((source) => {
    return `- ${source.label} / ${source.adapterKind}: ${source.status}，阻塞 ${source.summary.blockers}，提醒 ${source.summary.warnings}`;
  });
}

function runLines(externalAdapters) {
  const runs = externalAdapters.runs || [];
  if (!runs.length) return ["- 暂无 Adapter 运行记录"];
  return runs.slice(0, 8).map((run) => {
    const imported = run.imported_count || 0;
    const errors = run.error_count || 0;
    const suffix = run.error_message ? `，错误：${run.error_message}` : "";
    return `- ${run.adapter_kind} / ${run.mode}: ${run.status}，导入 ${imported}，错误 ${errors}${suffix}`;
  });
}

function buildCalibrationReport(bundle) {
  const { releaseRecord, adapterCalibration, launchReadiness, externalAdapters } = bundle;
  const blockers = releaseRecord.checklist.mustFixBeforeRelease || [];
  const warnings = releaseRecord.checklist.mustConfirmForGray || [];
  const lines = [
    `# ${releaseRecord.title}`,
    "",
    `目标：${releaseRecord.target}`,
    `状态：${releaseRecord.status}`,
    `建议：${releaseRecord.decision.recommendation}`,
    `生成时间：${releaseRecord.generatedAt}`,
    "",
    "## 上线闸口",
    `- 状态：${launchReadiness.status}`,
    `- 阻塞：${launchReadiness.summary.blockers}`,
    `- 提醒：${launchReadiness.summary.warnings}`,
    `- 通过：${launchReadiness.summary.passed}/${launchReadiness.summary.total}`,
    "",
    "## Adapter 校准",
    `- 状态：${adapterCalibration.status}`,
    `- 阻塞：${adapterCalibration.summary.blockers}`,
    `- 提醒：${adapterCalibration.summary.warnings}`,
    ...adapterLines(adapterCalibration),
    "",
    "## 必须修复",
    ...formatList(blockers, "暂无阻塞项"),
    "",
    "## 灰度确认",
    ...formatList(warnings, "暂无提醒项"),
    "",
    "## 缺失环境变量",
    ...formatList(missingEnvLines(releaseRecord).map((line) => line.slice(2)), "暂无缺失项"),
    "",
    "## 最近 Adapter 运行",
    ...runLines(externalAdapters),
    "",
    "## 回滚动作",
    ...formatList(releaseRecord.rollback || [], "暂无回滚动作"),
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(releaseRecord, args = {}) {
  if (args.allowBlocked) return 0;
  if (releaseRecord.status === "BLOCKED") return 2;
  if (args.strict && releaseRecord.status === "NEEDS_REVIEW") return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectCalibration(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildCalibrationReport(bundle));
    }
    process.exitCode = determineExitCode(bundle.releaseRecord, args);
  } catch (error) {
    process.stderr.write(`发布校准失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCalibrationReport,
  collectCalibration,
  determineExitCode,
  parseArgs,
};
