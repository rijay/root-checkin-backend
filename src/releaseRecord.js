const { nowISO } = require("./dates");
const adapterCalibration = require("./adapterCalibration");
const externalPlatformAdapters = require("./externalPlatformAdapters");
const launchReadiness = require("./launchReadiness");
const orderFulfillment = require("./orderFulfillment");

function statusFromInputs(readiness, calibration) {
  if (readiness.status === "BLOCKED" || calibration.status === "BLOCKED") return "BLOCKED";
  if (readiness.status === "NEEDS_REVIEW" || calibration.status === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  return "READY";
}

function decisionText(status) {
  if (status === "READY") return "可进入发布窗口";
  if (status === "NEEDS_REVIEW") return "可小流量灰度，但需要负责人确认提醒项";
  return "暂缓发布，先处理阻塞项";
}

function envPresence(env, names) {
  return names.map((name) => ({ name, present: Boolean(env && env[name]) }));
}

function releaseEvidence(data, context, readiness, calibration) {
  const recentRuns = externalPlatformAdapters.listAdapterRuns(data, 8);
  const cursors = externalPlatformAdapters.listAdapterCursors(data);
  return {
    storeAdapter: {
      kind: context.storeAdapter && context.storeAdapter.kind ? context.storeAdapter.kind : "memory",
    },
    env: envPresence(context.env, [
      "WECHAT_APPID",
      "WECHAT_APPSECRET",
      "ROOT_PUBLIC_BASE_URL",
      "ROOT_ADMIN_TOKEN",
      "ROOT_STORE_ADAPTER",
      "MYSQL_ADDRESS",
      "MYSQL_USERNAME",
      "MYSQL_PASSWORD",
      "MYSQL_DATABASE",
      "ROOT_SQLITE_FILE",
      "ROOT_STORE_FILE",
      "YOUZAN_ORDER_LIST_URL",
      "ROOT_FULFILLMENT_LIST_URL",
      "WEWORK_CONTACT_LIST_URL",
    ]),
    launchReadiness: {
      status: readiness.status,
      summary: readiness.summary,
      blockers: readiness.checks.filter((check) => check.status === "BLOCKER").map((check) => ({
        id: check.id,
        label: check.label,
        message: check.message,
      })),
      warnings: readiness.checks.filter((check) => check.status === "WARNING").map((check) => ({
        id: check.id,
        label: check.label,
        message: check.message,
      })),
    },
    adapterCalibration: {
      status: calibration.status,
      summary: calibration.summary,
      sources: calibration.sources.map((source) => ({
        sourceType: source.sourceType,
        adapterKind: source.adapterKind,
        label: source.label,
        status: source.status,
        blockers: source.summary.blockers,
        warnings: source.summary.warnings,
      })),
    },
    recentAdapterRuns: recentRuns.map((run) => ({
      runId: run.run_id,
      sourceType: run.source_type,
      adapterKind: run.adapter_kind,
      mode: run.mode,
      status: run.status,
      importedCount: run.imported_count || 0,
      errorCount: run.error_count || 0,
      warningCount: run.warning_count || 0,
      cursorAfter: run.cursor_after || "",
      finishedAt: run.finished_at || "",
      errorMessage: run.error_message || "",
    })),
    adapterCursors: cursors.map((cursor) => ({
      sourceType: cursor.source_type,
      adapterKind: cursor.adapter_kind,
      cursorValue: cursor.cursor_value,
      updatedAt: cursor.updated_at,
    })),
    operations: {
      openTasks: (data.operationTasks || []).filter((task) => task.status === "OPEN").length,
      pendingRefunds: (data.refundWorkItems || []).filter((item) => item.status === "PENDING").length,
      readyToStartUsers: orderFulfillment.getReadyToStartUsers(data).length,
      sampleReviews: (data.externalSampleReviews || []).length,
    },
  };
}

function buildReleaseChecklist(status, readiness, calibration) {
  const blockers = readiness.checks
    .filter((check) => check.status === "BLOCKER")
    .map((check) => `${check.label}: ${check.message}`)
    .concat(calibration.sources.flatMap((source) => {
      return source.checks
        .filter((check) => check.status === "BLOCKER")
        .map((check) => `${source.label}/${check.label}: ${check.message}`);
    }));
  const warnings = readiness.checks
    .filter((check) => check.status === "WARNING")
    .map((check) => `${check.label}: ${check.message}`)
    .concat(calibration.sources.flatMap((source) => {
      return source.checks
        .filter((check) => check.status === "WARNING")
        .map((check) => `${source.label}/${check.label}: ${check.message}`);
    }));
  return {
    mustFixBeforeRelease: blockers,
    mustConfirmForGray: warnings,
    finalChecks: [
      "确认小程序体验版连接的是 ROOT_PUBLIC_BASE_URL。",
      "确认数据仓库 Adapter 的备份或快照已完成。",
      "确认 MANUAL_SAMPLE 入口仍可作为真实 Adapter 回滚入口。",
      "确认免单退款和 Day8 问卷人工处理负责人在线。",
    ],
    statusHint: decisionText(status),
  };
}

function buildReleaseRecord(data, options = {}) {
  const context = {
    storeAdapter: options.storeAdapter || { kind: "memory" },
    env: options.env || process.env,
    adapterImplementations: options.adapterImplementations || {},
    fetchImpl: options.fetchImpl,
  };
  const readiness = launchReadiness.buildLaunchReadiness(data, { ...context, target: options.target || "production" });
  const calibration = adapterCalibration.buildAdapterCalibration(data, context);
  const status = statusFromInputs(readiness, calibration);
  return {
    title: "ROOT 7日打卡发布记录",
    status,
    target: readiness.target,
    generatedAt: nowISO(),
    decision: {
      recommendation: decisionText(status),
      releaseOwner: "",
      operationOwner: "",
      engineeringOwner: "",
      approvedAt: "",
      note: "",
    },
    signoffs: [
      { role: "产品", owner: "", status: "PENDING", note: "确认流程和风险提示" },
      { role: "运营", owner: "", status: "PENDING", note: "确认企业微信触达、免单和样本导入" },
      { role: "研发", owner: "", status: "PENDING", note: "确认环境变量、数据仓库 Adapter 和回滚路径" },
    ],
    checklist: buildReleaseChecklist(status, readiness, calibration),
    evidence: releaseEvidence(data, context, readiness, calibration),
    rollback: [
      "暂停 YOUZAN_OPEN、FULFILLMENT_PUSH、WEWORK_CONTACT 真实 Adapter。",
      "继续使用 MANUAL_SAMPLE 和后台手工同步订单/物流/线索。",
      "保留当前数据仓库快照，必要时回退到发布前快照。",
      "在企业微信通知运营改用人工提醒和人工退款审核。",
    ],
  };
}

module.exports = {
  buildReleaseRecord,
};
