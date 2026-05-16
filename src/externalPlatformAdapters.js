const { nowISO, todayISO } = require("./dates");
const externalAdapterSamples = require("./externalAdapterSamples");
const { createId } = require("./seed");
const { createDefaultAdapterImplementations } = require("./externalAdapterImplementations");

const ADAPTER_KINDS = {
  MANUAL_SAMPLE: "MANUAL_SAMPLE",
  YOUZAN_OPEN: "YOUZAN_OPEN",
  FULFILLMENT_PUSH: "FULFILLMENT_PUSH",
  WEWORK_CONTACT: "WEWORK_CONTACT",
};

const REAL_ADAPTER_CONFIGS = [
  {
    sourceType: "YOUZAN_ORDER",
    label: "有赞订单 Adapter",
    adapterKind: ADAPTER_KINDS.YOUZAN_OPEN,
    requiredEnv: ["YOUZAN_CLIENT_ID", "YOUZAN_CLIENT_SECRET"],
    cursorLabel: "订单增量游标",
    nextAction: "配置有赞凭证后启用订单拉取 Implementation。",
  },
  {
    sourceType: "FULFILLMENT",
    label: "物流状态 Adapter",
    adapterKind: ADAPTER_KINDS.FULFILLMENT_PUSH,
    requiredEnv: ["ROOT_FULFILLMENT_SECRET"],
    cursorLabel: "物流增量游标",
    nextAction: "确认物流来源后启用签收和异常件拉取或推送 Implementation。",
  },
  {
    sourceType: "WECHAT_LEAD",
    label: "企业微信线索 Adapter",
    adapterKind: ADAPTER_KINDS.WEWORK_CONTACT,
    requiredEnv: ["WEWORK_CORP_ID", "WEWORK_CONTACT_SECRET"],
    cursorLabel: "企微增量游标",
    nextAction: "配置企业微信通讯录或客户联系凭证后启用线索拉取 Implementation。",
  },
];

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMode(mode) {
  return String(mode || "PREVIEW").toUpperCase() === "IMPORT" ? "IMPORT" : "PREVIEW";
}

function normalizeAdapterKind(adapterKind) {
  return String(adapterKind || ADAPTER_KINDS.MANUAL_SAMPLE).toUpperCase();
}

function missingEnv(env, names) {
  return names.filter((name) => !env || !env[name]);
}

function adapterKey(sourceType, adapterKind) {
  return `${sourceType}:${adapterKind}`;
}

function isRealAdapter(adapterKind) {
  return adapterKind !== ADAPTER_KINDS.MANUAL_SAMPLE;
}

function ensureAdapterRuns(data) {
  if (!Array.isArray(data.externalAdapterRuns)) data.externalAdapterRuns = [];
  return data.externalAdapterRuns;
}

function ensureAdapterCursors(data) {
  if (!Array.isArray(data.externalAdapterCursors)) data.externalAdapterCursors = [];
  return data.externalAdapterCursors;
}

function listAdapterRuns(data, limit = 20) {
  return ensureAdapterRuns(data).slice(0, limit);
}

function listAdapterCursors(data) {
  return ensureAdapterCursors(data).slice();
}

function cursorFor(data, sourceType, adapterKind) {
  return ensureAdapterCursors(data).find((item) => item.adapter_key === adapterKey(sourceType, adapterKind)) || null;
}

function latestRunFor(data, sourceType, adapterKind) {
  return ensureAdapterRuns(data).find((item) => item.source_type === sourceType && item.adapter_kind === adapterKind) || null;
}

function manualAdapterStatus(sourceType, data) {
  const template = externalAdapterSamples.sampleTemplateFor(sourceType);
  const adapterKind = ADAPTER_KINDS.MANUAL_SAMPLE;
  return {
    sourceType,
    label: `${template.label}手工取样 Adapter`,
    adapterKind,
    status: "READY",
    requiredEnv: [],
    missingEnv: [],
    cursor: cursorFor(data || {}, sourceType, adapterKind),
    latestRun: latestRunFor(data || {}, sourceType, adapterKind),
    nextAction: "粘贴真实导出样本后即可预览或导入。",
  };
}

function realAdapterStatus(env, config, data, implementations = {}) {
  const missing = missingEnv(env, config.requiredEnv);
  const hasImplementation = typeof implementations[config.adapterKind] === "function";
  const status = missing.length ? "NEEDS_CONFIG" : hasImplementation ? "READY" : "CONFIG_READY";
  return {
    ...config,
    status,
    missingEnv: missing,
    cursor: cursorFor(data || {}, config.sourceType, config.adapterKind),
    latestRun: latestRunFor(data || {}, config.sourceType, config.adapterKind),
    nextAction: missing.length
      ? `补齐环境变量：${missing.join(", ")}`
      : hasImplementation
        ? "可运行真实平台拉取。"
        : config.nextAction,
  };
}

function buildAdapterCatalog(env = process.env, options = {}) {
  const data = options.data || {};
  const implementations = createDefaultAdapterImplementations(env, options);
  const manualAdapters = REAL_ADAPTER_CONFIGS.map((config) => manualAdapterStatus(config.sourceType, data));
  const realAdapters = REAL_ADAPTER_CONFIGS.map((config) => realAdapterStatus(env, config, data, implementations));
  return {
    manualAdapters,
    realAdapters,
    adapters: manualAdapters.concat(realAdapters),
  };
}

function sampleInputFromBody(body = {}) {
  if (body.samples !== undefined) return body.samples;
  if (body.text !== undefined) return body.text;
  return "";
}

function fetchSamplesWithManualAdapter(body = {}) {
  const input = sampleInputFromBody(body);
  const hasInput = Array.isArray(input) ? input.length > 0 : String(input || "").trim() !== "";
  if (!hasInput) throw adapterError(400, "MANUAL_SAMPLE Adapter 需要 text 或 samples");
  return {
    input,
    externalCount: Array.isArray(input) ? input.length : 0,
    cursorBefore: "",
    cursorAfter: "",
    hasMore: false,
  };
}

function configuredRealAdapter(env, adapterKind) {
  const catalog = buildAdapterCatalog(env);
  const adapter = catalog.realAdapters.find((item) => item.adapterKind === adapterKind);
  if (!adapter) throw adapterError(400, "未知外部平台 Adapter");
  if (adapter.status === "NEEDS_CONFIG") {
    throw adapterError(400, `${adapter.label} 未配置：${adapter.missingEnv.join(", ")}`, adapter);
  }
  return adapter;
}

function normalizeExternalFetchResult(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return { input: value, externalCount: Array.isArray(value) ? value.length : 0, cursorAfter: "", hasMore: false };
  }
  const result = value || {};
  const input = result.samples !== undefined ? result.samples : result.text;
  return {
    input: input === undefined ? [] : input,
    externalCount: result.externalCount === undefined
      ? Array.isArray(input) ? input.length : 0
      : Number(result.externalCount) || 0,
    cursorAfter: result.nextCursor || result.next_cursor || result.cursorAfter || result.cursor_after || "",
    hasMore: Boolean(result.hasMore || result.has_more),
  };
}

async function fetchSamplesWithRealAdapter(data, env, body, options, sourceType, adapterKind) {
  const adapter = configuredRealAdapter(env, adapterKind);
  const implementations = createDefaultAdapterImplementations(env, options);
  const implementation = implementations[adapterKind];
  if (typeof implementation !== "function") {
    throw adapterError(501, `${adapter.label} 的真实拉取 Implementation 尚未启用`, adapter);
  }

  const existingCursor = cursorFor(data, sourceType, adapterKind);
  const cursorBefore = body.cursor || body.cursor_before || (existingCursor ? existingCursor.cursor_value : "");
  const limit = Number(body.limit || body.pageSize || body.page_size || 50);
  const fetched = normalizeExternalFetchResult(await implementation({
    adapter,
    sourceType,
    adapterKind,
    cursor: cursorBefore,
    limit,
    body,
    env,
    fetchImpl: options.fetchImpl,
  }));
  return {
    ...fetched,
    cursorBefore,
    requestedLimit: limit,
  };
}

async function fetchSamples(data, env, body = {}, options = {}, sourceType, adapterKind) {
  if (adapterKind === ADAPTER_KINDS.MANUAL_SAMPLE) return fetchSamplesWithManualAdapter(body);
  return fetchSamplesWithRealAdapter(data, env, body, options, sourceType, adapterKind);
}

function recordAdapterRun(data, run) {
  ensureAdapterRuns(data).unshift(run);
  data.externalAdapterRuns = ensureAdapterRuns(data).slice(0, 50);
  return run;
}

function upsertAdapterCursor(data, run) {
  if (!isRealAdapter(run.adapter_kind)) return null;
  if (!run.cursor_after) return null;
  const cursors = ensureAdapterCursors(data);
  const key = adapterKey(run.source_type, run.adapter_kind);
  let cursor = cursors.find((item) => item.adapter_key === key);
  if (!cursor) {
    cursor = {
      adapter_cursor_id: createId("adc"),
      adapter_key: key,
      source_type: run.source_type,
      adapter_kind: run.adapter_kind,
      cursor_value: "",
      last_successful_run_id: "",
      last_successful_at: "",
      updated_at: nowISO(),
    };
    cursors.push(cursor);
  }
  cursor.cursor_value = run.cursor_after;
  cursor.last_successful_run_id = run.run_id;
  cursor.last_successful_at = run.finished_at || nowISO();
  cursor.updated_at = nowISO();
  return cursor;
}

function buildRunBase(sourceType, adapterKind, mode, startedAt, fetched) {
  return {
    run_id: createId("adr"),
    source_type: sourceType,
    adapter_kind: adapterKind,
    mode,
    status: "STARTED",
    total: 0,
    importable_count: 0,
    imported_count: 0,
    error_count: 0,
    warning_count: 0,
    external_count: fetched ? fetched.externalCount || 0 : 0,
    requested_limit: fetched ? fetched.requestedLimit || 0 : 0,
    cursor_before: fetched ? fetched.cursorBefore || "" : "",
    cursor_after: fetched ? fetched.cursorAfter || "" : "",
    has_more: fetched ? Boolean(fetched.hasMore) : false,
    review_id: "",
    error_code: "",
    error_message: "",
    started_at: startedAt,
    finished_at: "",
  };
}

function shouldCommitCursor(adapterKind, mode, body) {
  if (!isRealAdapter(adapterKind)) return false;
  if (body.commitCursor || body.commit_cursor) return true;
  return mode === "IMPORT";
}

async function runAdapter(data, body = {}, options = {}) {
  const rawSourceType = body.sourceType || body.source_type || "";
  const sourceType = externalAdapterSamples.sampleTemplateFor(rawSourceType).sourceType;
  const adapterKind = normalizeAdapterKind(body.adapterKind || body.adapter_kind);
  const mode = normalizeMode(body.mode);
  const startedAt = nowISO();
  let fetched = null;

  try {
    fetched = await fetchSamples(data, options.env || process.env, { ...body, adapterKind }, options, sourceType, adapterKind);
    const result = mode === "IMPORT"
      ? externalAdapterSamples.importExternalSamples(data, sourceType, fetched.input, options.dateText || todayISO())
      : externalAdapterSamples.previewExternalSamples(data, sourceType, fetched.input);
    const review = externalAdapterSamples.recordExternalSampleReview(data, mode === "IMPORT" ? "ADAPTER_IMPORT" : "ADAPTER_PREVIEW", result);
    const run = recordAdapterRun(data, {
      ...buildRunBase(sourceType, adapterKind, mode, startedAt, fetched),
      status: result.errorCount ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      total: result.total || 0,
      importable_count: result.importableCount || 0,
      imported_count: result.importedCount || 0,
      error_count: result.errorCount || 0,
      warning_count: result.warningCount || 0,
      review_id: review.review_id,
      finished_at: nowISO(),
    });
    const cursor = shouldCommitCursor(adapterKind, mode, body) ? upsertAdapterCursor(data, run) : null;
    return {
      adapterKind,
      mode,
      sourceType,
      result,
      review,
      run,
      cursor,
    };
  } catch (error) {
    const run = recordAdapterRun(data, {
      ...buildRunBase(sourceType, adapterKind, mode, startedAt, fetched),
      status: "FAILED",
      error_code: String(error.code || 500),
      error_message: error.message || "Adapter 运行失败",
      finished_at: nowISO(),
    });
    error.run = run;
    throw error;
  }
}

module.exports = {
  ADAPTER_KINDS,
  buildAdapterCatalog,
  listAdapterCursors,
  listAdapterRuns,
  runAdapter,
};
