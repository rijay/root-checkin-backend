const { nowISO } = require("./dates");
const externalAdapterSamples = require("./externalAdapterSamples");
const externalPlatformAdapters = require("./externalPlatformAdapters");

const CALIBRATION_SOURCES = [
  {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    label: "有赞订单",
    requiredEnv: ["YOUZAN_CLIENT_ID", "YOUZAN_CLIENT_SECRET", "YOUZAN_ACCESS_TOKEN", "YOUZAN_ORDER_LIST_URL"],
    optionalEnv: ["YOUZAN_ORDER_LIST_DATA_PATH", "YOUZAN_ORDER_LIST_CURSOR_PATH", "YOUZAN_ORDER_LIST_HAS_MORE_PATH", "YOUZAN_ORDER_FIELD_MAP"],
    fieldMapEnv: "YOUZAN_ORDER_FIELD_MAP",
    playbook: [
      "先用真实订单导出补齐至少 3 条样本，并让 Adapter 准入达到 READY。",
      "用 PREVIEW 运行 YOUZAN_OPEN，确认订单号、手机号、金额、订单状态、物流状态字段映射正确。",
      "用 IMPORT 小批量导入 1 页，确认订单可被用户手机号匹配，且游标推进。",
    ],
    rollback: "暂停 YOUZAN_OPEN，继续使用 MANUAL_SAMPLE 或后台手工同步订单。",
  },
  {
    sourceType: "FULFILLMENT",
    adapterKind: "FULFILLMENT_PUSH",
    label: "物流状态",
    requiredEnv: ["ROOT_FULFILLMENT_SECRET", "ROOT_FULFILLMENT_LIST_URL"],
    optionalEnv: ["ROOT_FULFILLMENT_LIST_DATA_PATH", "ROOT_FULFILLMENT_LIST_CURSOR_PATH", "ROOT_FULFILLMENT_LIST_HAS_MORE_PATH", "ROOT_FULFILLMENT_FIELD_MAP"],
    fieldMapEnv: "ROOT_FULFILLMENT_FIELD_MAP",
    playbook: [
      "先用真实物流导出补齐至少 3 条样本，并覆盖运输中、已签收和异常件。",
      "用 PREVIEW 运行 FULFILLMENT_PUSH，确认订单号、运单号、物流状态和签收时间字段映射正确。",
      "用 IMPORT 小批量导入 1 页，确认 DELIVERED 会进入已送达待开始或用户可启动 Day1。",
    ],
    rollback: "暂停 FULFILLMENT_PUSH，保留手工更新物流状态入口。",
  },
  {
    sourceType: "WECHAT_LEAD",
    adapterKind: "WEWORK_CONTACT",
    label: "企业微信线索",
    requiredEnv: ["WEWORK_CORP_ID", "WEWORK_CONTACT_LIST_URL"],
    anyOfEnv: [["WEWORK_CONTACT_SECRET", "WEWORK_CONTACT_ACCESS_TOKEN", "WEWORK_ACCESS_TOKEN"]],
    optionalEnv: ["WEWORK_CONTACT_LIST_DATA_PATH", "WEWORK_CONTACT_LIST_CURSOR_PATH", "WEWORK_CONTACT_LIST_HAS_MORE_PATH", "WEWORK_CONTACT_FIELD_MAP"],
    fieldMapEnv: "WEWORK_CONTACT_FIELD_MAP",
    playbook: [
      "先用真实企微线索补齐至少 3 条样本，并确认备注名和来源活动的真实格式。",
      "用 PREVIEW 运行 WEWORK_CONTACT，确认外部联系人 ID、备注名、手机号、来源活动和添加状态字段映射正确。",
      "用 IMPORT 小批量导入 1 页，确认缺手机号或未匹配用户会生成 LEAD_NEEDS_MATCHING 待办。",
    ],
    rollback: "暂停 WEWORK_CONTACT，继续由运营手工记录企业微信线索和备注名。",
  },
];

function makeCheck(id, label, status, message, detail = {}) {
  return { id, label, status, message, detail };
}

function presentEnv(env, name) {
  return Boolean(env && env[name]);
}

function envChecklist(env, names) {
  return names.map((name) => ({ name, present: presentEnv(env, name) }));
}

function missingEnv(env, names) {
  return names.filter((name) => !presentEnv(env, name));
}

function anyOfChecklist(env, groups = []) {
  return groups.map((names) => ({
    names,
    present: names.some((name) => presentEnv(env, name)),
    presentNames: names.filter((name) => presentEnv(env, name)),
  }));
}

function latestRunFor(runs, adapterKind) {
  return runs.find((run) => run.adapter_kind === adapterKind) || null;
}

function latestSuccessfulRunFor(runs, adapterKind) {
  return runs.find((run) => run.adapter_kind === adapterKind && run.status === "COMPLETED") || null;
}

function cursorFor(cursors, adapterKind) {
  return cursors.find((cursor) => cursor.adapter_kind === adapterKind) || null;
}

function readinessCheck(readiness) {
  if (!readiness) {
    return makeCheck("sample_readiness", "样本准入", "BLOCKER", "还没有样本准入结果。");
  }
  if (readiness.status === "READY") {
    return makeCheck("sample_readiness", "样本准入", "PASS", "样本数量、必填字段和状态枚举已达到准入。", readiness);
  }
  if (readiness.status === "NEEDS_REVIEW") {
    return makeCheck("sample_readiness", "样本准入", "WARNING", "样本可继续，但仍有提醒项需要确认。", readiness);
  }
  const reasons = (readiness.blockingReasons || []).map((item) => item.message).join("；") || "样本准入未通过";
  return makeCheck("sample_readiness", "样本准入", "BLOCKER", reasons, readiness);
}

function configurationCheck(source, env) {
  const missingRequired = missingEnv(env, source.requiredEnv || []);
  const anyOf = anyOfChecklist(env, source.anyOfEnv || []);
  const missingAnyOf = anyOf.filter((group) => !group.present);
  if (!missingRequired.length && !missingAnyOf.length) {
    return makeCheck("configuration", "运行配置", "PASS", "必要环境变量已配置。", { missingRequired, anyOf });
  }
  const parts = [];
  if (missingRequired.length) parts.push(`缺少 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) parts.push(`至少需要其一：${missingAnyOf.map((group) => group.names.join(" / ")).join("；")}`);
  return makeCheck("configuration", "运行配置", "BLOCKER", parts.join("；"), { missingRequired, anyOf });
}

function implementationCheck(adapter) {
  if (!adapter) return makeCheck("implementation", "真实 Adapter", "BLOCKER", "没有找到真实 Adapter 状态。");
  if (adapter.status === "READY") return makeCheck("implementation", "真实 Adapter", "PASS", "真实 Adapter 已可运行。", adapter);
  if (adapter.status === "CONFIG_READY") {
    return makeCheck("implementation", "真实 Adapter", "WARNING", "基础凭证已配置，但默认 HTTP Implementation 还未满足运行条件。", adapter);
  }
  return makeCheck("implementation", "真实 Adapter", "BLOCKER", adapter.nextAction || "真实 Adapter 未配置。", adapter);
}

function runCheck(latestRun, latestSuccessfulRun) {
  if (latestSuccessfulRun) {
    return makeCheck("latest_run", "最近成功运行", "PASS", `最近成功运行：${latestSuccessfulRun.mode}，导入 ${latestSuccessfulRun.imported_count || 0} 条。`, latestSuccessfulRun);
  }
  if (latestRun && latestRun.status === "FAILED") {
    return makeCheck("latest_run", "最近成功运行", "WARNING", `最近运行失败：${latestRun.error_message || "未知错误"}`, latestRun);
  }
  return makeCheck("latest_run", "最近成功运行", "WARNING", "还没有成功运行记录，先用 PREVIEW 小批量校准。");
}

function cursorCheck(cursor, latestSuccessfulRun) {
  if (cursor && cursor.cursor_value) {
    return makeCheck("cursor", "增量游标", "PASS", "已保存增量游标，后续可从上次位置继续。", cursor);
  }
  if (latestSuccessfulRun) {
    return makeCheck("cursor", "增量游标", "WARNING", "最近成功运行未返回游标，需要确认平台是否支持增量分页。", latestSuccessfulRun);
  }
  return makeCheck("cursor", "增量游标", "WARNING", "还没有游标，首次 IMPORT 成功后应写入。");
}

function summarize(checks) {
  const blockers = checks.filter((item) => item.status === "BLOCKER").length;
  const warnings = checks.filter((item) => item.status === "WARNING").length;
  const passed = checks.filter((item) => item.status === "PASS").length;
  return { blockers, warnings, passed, total: checks.length };
}

function statusFromSummary(summary) {
  if (summary.blockers) return "BLOCKED";
  if (summary.warnings) return "NEEDS_REVIEW";
  return "READY";
}

function buildSourceCalibration(source, context) {
  const readiness = context.adapterReadiness.sources.find((item) => item.sourceType === source.sourceType) || null;
  const adapter = context.catalog.realAdapters.find((item) => item.adapterKind === source.adapterKind) || null;
  const latestRun = latestRunFor(context.runs, source.adapterKind);
  const latestSuccessfulRun = latestSuccessfulRunFor(context.runs, source.adapterKind);
  const cursor = cursorFor(context.cursors, source.adapterKind);
  const checks = [
    readinessCheck(readiness),
    configurationCheck(source, context.env),
    implementationCheck(adapter),
    runCheck(latestRun, latestSuccessfulRun),
    cursorCheck(cursor, latestSuccessfulRun),
  ];
  const summary = summarize(checks);
  return {
    sourceType: source.sourceType,
    adapterKind: source.adapterKind,
    label: source.label,
    status: statusFromSummary(summary),
    summary,
    checks,
    env: {
      required: envChecklist(context.env, source.requiredEnv || []),
      anyOf: anyOfChecklist(context.env, source.anyOfEnv || []),
      optional: envChecklist(context.env, source.optionalEnv || []),
      fieldMapEnv: source.fieldMapEnv,
      hasFieldMap: presentEnv(context.env, source.fieldMapEnv),
    },
    playbook: source.playbook,
    rollback: source.rollback,
  };
}

function buildAdapterCalibration(data, options = {}) {
  const env = options.env || process.env;
  const catalog = externalPlatformAdapters.buildAdapterCatalog(env, {
    data,
    adapterImplementations: options.adapterImplementations || {},
    fetchImpl: options.fetchImpl,
  });
  const context = {
    env,
    catalog,
    runs: externalPlatformAdapters.listAdapterRuns(data, 50),
    cursors: externalPlatformAdapters.listAdapterCursors(data),
    adapterReadiness: externalAdapterSamples.buildAdapterReadiness(data, { requiredSamples: 3 }),
  };
  const sources = CALIBRATION_SOURCES.map((source) => buildSourceCalibration(source, context));
  const summary = summarize(sources.flatMap((source) => source.checks));
  return {
    status: statusFromSummary(summary),
    generatedAt: nowISO(),
    summary,
    sources,
    sequence: [
      "样本准入 READY 后再运行真实 Adapter。",
      "先 PREVIEW 小批量确认字段映射，再 IMPORT 单页推进游标。",
      "灰度首日保留 MANUAL_SAMPLE 和后台手工修正入口。",
      "若出现映射错误、未知枚举或重复导入，暂停真实 Adapter 并回到手工链路。",
    ],
  };
}

module.exports = {
  buildAdapterCalibration,
};
