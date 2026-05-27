const { nowISO, todayISO } = require("./dates");
const { normalizePhone } = require("./identity");
const operationTask = require("./operationTask");
const orderFulfillment = require("./orderFulfillment");
const { createId } = require("./seed");

const SOURCE_TYPES = {
  YOUZAN_ORDER: "YOUZAN_ORDER",
  FULFILLMENT: "FULFILLMENT",
  WECHAT_LEAD: "WECHAT_LEAD",
};

const SOURCE_LABELS = {
  YOUZAN_ORDER: "有赞订单",
  FULFILLMENT: "物流状态",
  WECHAT_LEAD: "企业微信线索",
};

const SAMPLE_TEMPLATES = {
  YOUZAN_ORDER: {
    sourceType: "YOUZAN_ORDER",
    label: SOURCE_LABELS.YOUZAN_ORDER,
    requiredSamples: 3,
    requiredFields: ["有赞订单号", "收货手机号"],
    recommendedFields: ["收货人", "商品名称", "商品ID", "实付金额", "订单状态", "物流状态", "支付时间", "收货地址"],
    csvHeader: "有赞订单号,收货人,收货手机号,商品名称,商品ID,实付金额,订单状态,物流状态,支付时间,收货地址",
    notes: [
      "至少复制 3 条真实订单，覆盖已发货、已签收或异常等实际状态。",
      "收货手机号用于和小程序用户匹配，不要手工脱敏后再导入。",
      "如果导出没有收货地址，可以先预览，但需要在提醒项里确认是否接受。",
    ],
  },
  FULFILLMENT: {
    sourceType: "FULFILLMENT",
    label: SOURCE_LABELS.FULFILLMENT,
    requiredSamples: 3,
    requiredFields: ["有赞订单号", "物流状态"],
    recommendedFields: ["快递公司", "运单号", "发货时间", "签收时间", "最新物流节点"],
    csvHeader: "有赞订单号,快递公司,运单号,物流状态,发货时间,签收时间,最新物流节点",
    notes: [
      "至少复制 3 条真实物流记录，优先覆盖运输中、已签收和异常件。",
      "有赞订单号必须能在订单样本或后台订单中找到。",
      "如果已签收但缺少签收时间，系统会提示运营确认是否接受。",
    ],
  },
  WECHAT_LEAD: {
    sourceType: "WECHAT_LEAD",
    label: SOURCE_LABELS.WECHAT_LEAD,
    requiredSamples: 3,
    requiredFields: ["外部联系人ID 或 企业微信备注名"],
    recommendedFields: ["收货手机号", "来源活动", "线下活动", "当前添加状态", "运营备注"],
    csvHeader: "外部联系人ID,企业微信备注名,收货手机号,来源活动,线下活动,当前添加状态,运营备注",
    notes: [
      "至少复制 3 条真实企业微信外部联系人或活动线索。",
      "建议带收货手机号，缺少手机号会进入线索人工匹配待办。",
      "备注名最好保留运营实际使用的格式，用来验证人工匹配规则。",
    ],
  },
};

const FIELD_ALIASES = {
  YOUZAN_ORDER: {
    youzanOrderNo: ["youzanOrderNo", "youzan_order_no", "orderNo", "order_no", "订单号", "有赞订单号", "订单编号"],
    receiverPhone: ["receiverPhone", "receiver_phone", "phone", "手机号", "收货手机号", "收件手机号", "收货人手机号/提货人手机号", "买家手机号"],
    receiverName: ["receiverName", "receiver_name", "receiver", "收货人", "收件人", "收货人/提货人", "买家昵称"],
    productName: ["productName", "product_name", "商品名称", "商品名", "全部商品名称"],
    productId: ["productId", "product_id", "商品ID", "商品id", "商品编码"],
    amount: ["amount", "实付金额", "支付金额", "订单金额", "订单实付金额", "应收订单金额"],
    paidAt: ["paidAt", "paid_at", "支付时间", "付款时间", "买家付款时间", "订单创建时间"],
    orderStatus: ["orderStatus", "order_status", "订单状态", "支付状态"],
    deliveryStatus: ["deliveryStatus", "delivery_status", "物流状态", "配送状态", "订单状态"],
    rawAddressText: ["rawAddressText", "raw_address_text", "地址", "收货地址", "原始地址文本", "详细收货地址/提货地址"],
  },
  FULFILLMENT: {
    orderId: ["orderId", "order_id"],
    youzanOrderNo: ["youzanOrderNo", "youzan_order_no", "orderNo", "order_no", "订单号", "有赞订单号", "订单编号"],
    receiverPhone: ["receiverPhone", "receiver_phone", "phone", "手机号", "收货手机号", "收件手机号"],
    receiverName: ["receiverName", "receiver_name", "receiver", "收货人", "收件人"],
    carrier: ["carrier", "快递公司", "物流公司", "承运商"],
    trackingNo: ["trackingNo", "tracking_no", "运单号", "快递单号", "物流单号"],
    deliveryStatus: ["deliveryStatus", "delivery_status", "物流状态", "配送状态"],
    shippedAt: ["shippedAt", "shipped_at", "发货时间"],
    deliveredAt: ["deliveredAt", "delivered_at", "签收时间", "送达时间"],
    lastEventText: ["lastEventText", "last_event_text", "最新物流节点", "物流节点", "最新状态"],
  },
  WECHAT_LEAD: {
    userId: ["userId", "user_id", "用户ID"],
    receiverPhone: ["receiverPhone", "receiver_phone", "phone", "手机号", "收货手机号", "备注手机号"],
    externalContactId: ["externalContactId", "external_contact_id", "外部联系人ID", "外部联系人id", "企微外部联系人ID"],
    remarkName: ["remarkName", "remark_name", "wechatRemarkName", "wechat_remark_name", "企业微信备注名", "企微备注", "备注名"],
    sourceChannel: ["sourceChannel", "source_channel", "来源渠道", "来源活动", "活动来源"],
    offlineEventName: ["offlineEventName", "offline_event_name", "线下活动", "活动名称"],
    corpWechatStatus: ["corpWechatStatus", "corp_wechat_status", "当前添加状态", "添加状态", "企微状态"],
    operatorNote: ["operatorNote", "operator_note", "运营备注", "备注"],
  },
};

const REQUIRED_FIELDS = {
  YOUZAN_ORDER: ["youzanOrderNo", "receiverPhone"],
  FULFILLMENT: ["deliveryStatus"],
  WECHAT_LEAD: [],
};

const DELIVERY_STATUS_MAP = new Map([
  ["NOT_SHIPPED", "NOT_SHIPPED"],
  ["未发货", "NOT_SHIPPED"],
  ["待发货", "NOT_SHIPPED"],
  ["已支付", "NOT_SHIPPED"],
  ["SHIPPED", "SHIPPED"],
  ["已发货", "SHIPPED"],
  ["运输中", "SHIPPED"],
  ["配送中", "SHIPPED"],
  ["DELIVERED", "DELIVERED"],
  ["已签收", "DELIVERED"],
  ["签收", "DELIVERED"],
  ["已送达", "DELIVERED"],
  ["送达", "DELIVERED"],
  ["交易成功", "DELIVERED"],
  ["已完成", "DELIVERED"],
  ["EXCEPTION", "EXCEPTION"],
  ["异常", "EXCEPTION"],
  ["物流异常", "EXCEPTION"],
]);

const VALID_DELIVERY_STATUSES = new Set(["NOT_SHIPPED", "SHIPPED", "DELIVERED", "EXCEPTION"]);

const ORDER_STATUS_MAP = new Map([
  ["PAID", "PAID"],
  ["已支付", "PAID"],
  ["已付款", "PAID"],
  ["待发货", "PAID"],
  ["已发货", "PAID"],
  ["交易成功", "PAID"],
  ["已完成", "PAID"],
  ["CLOSED", "CLOSED"],
  ["已关闭", "CLOSED"],
  ["REFUNDED", "REFUNDED"],
  ["已退款", "REFUNDED"],
]);

const VALID_ORDER_STATUSES = new Set(["PAID", "CLOSED", "REFUNDED"]);

function sampleError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function valueFor(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] === undefined || row[alias] === null) continue;
    const value = typeof row[alias] === "string" ? row[alias].trim() : row[alias];
    if (value !== "") return value;
  }
  return "";
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeAmount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const amount = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeMappedStatus(value, map, fallback = "") {
  const text = normalizeString(value);
  if (!text) return fallback;
  return map.get(text) || map.get(text.toUpperCase()) || text;
}

function ensureStatusMappings(data) {
  if (!Array.isArray(data.externalStatusMappings)) data.externalStatusMappings = [];
  return data.externalStatusMappings;
}

function statusMapFor(data, sourceType, field) {
  const baseMap = field === "deliveryStatus" ? new Map(DELIVERY_STATUS_MAP) : new Map(ORDER_STATUS_MAP);
  ensureStatusMappings(data).forEach((mapping) => {
    const sameSource = mapping.source_type === sourceType || mapping.source_type === "ANY";
    if (!sameSource || mapping.field !== field) return;
    baseMap.set(mapping.raw_value, mapping.canonical_value);
  });
  return baseMap;
}

function normalizeField(data, sourceType, field, value) {
  if (field === "receiverPhone") return normalizePhone(value);
  if (field === "amount") return normalizeAmount(value);
  if (field === "deliveryStatus") return normalizeMappedStatus(value, statusMapFor(data, sourceType, field), "NOT_SHIPPED");
  if (field === "orderStatus") return normalizeMappedStatus(value, statusMapFor(data, sourceType, field), "PAID");
  return normalizeString(value);
}

function normalizeSourceType(sourceType) {
  const type = normalizeString(sourceType).toUpperCase();
  if (type === "ANY") return type;
  if (!SOURCE_TYPES[type]) throw sampleError(400, "未知样本来源");
  return type;
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function delimiterForText(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function parseTabularText(text) {
  const cleaned = normalizeString(text).replace(/^\uFEFF/, "");
  if (!cleaned) return [];
  if (cleaned.startsWith("[") || cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      throw sampleError(400, `JSON 样本格式错误：${error.message}`);
    }
  }

  const rows = parseDelimitedRows(cleaned, delimiterForText(cleaned))
    .map((row) => row.map(normalizeString))
    .filter((row) => row.some(Boolean));
  if (rows.length < 2) throw sampleError(400, "表格文本至少需要标题行和一行数据");

  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    return headers.reduce((record, header, index) => {
      if (header) record[header] = cells[index] || "";
      return record;
    }, {});
  });
}

function inputTypeFromText(text) {
  const cleaned = normalizeString(text).replace(/^\uFEFF/, "");
  if (cleaned.startsWith("[") || cleaned.startsWith("{")) return "JSON";
  return delimiterForText(cleaned) === "\t" ? "TSV" : "CSV";
}

function samplesFromBody(samples) {
  if (Array.isArray(samples)) return { rows: samples, inputType: "JSON" };
  if (typeof samples === "string") return { rows: parseTabularText(samples), inputType: inputTypeFromText(samples) };
  throw sampleError(400, "samples 必须是数组，或使用 text 传入 JSON/CSV/表格文本");
}

function mapSampleRow(data, sourceType, row) {
  const aliases = FIELD_ALIASES[sourceType];
  return Object.entries(aliases).reduce((result, [field, fieldAliases]) => {
    const rawValue = valueFor(row, fieldAliases);
    result.mapped[field] = normalizeField(data, sourceType, field, rawValue);
    result.fieldPresence[field] = rawValue !== "";
    return result;
  }, { mapped: {}, fieldPresence: {} });
}

function validateMappedRow(sourceType, mapped) {
  const errors = [];
  const warnings = [];
  for (const field of REQUIRED_FIELDS[sourceType]) {
    if (!mapped[field]) errors.push(`${field} 缺失`);
  }
  if (sourceType === "FULFILLMENT" && !mapped.orderId && !mapped.youzanOrderNo) {
    errors.push("orderId 或 youzanOrderNo 至少需要一个");
  }
  if (sourceType === "WECHAT_LEAD" && !mapped.externalContactId && !mapped.remarkName) {
    errors.push("externalContactId 或 remarkName 至少需要一个");
  }
  if (mapped.deliveryStatus && !VALID_DELIVERY_STATUSES.has(mapped.deliveryStatus)) {
    errors.push(`deliveryStatus 未知：${mapped.deliveryStatus}`);
  }
  if (mapped.orderStatus && !VALID_ORDER_STATUSES.has(mapped.orderStatus)) {
    errors.push(`orderStatus 未知：${mapped.orderStatus}`);
  }
  if (sourceType === "YOUZAN_ORDER" && !mapped.rawAddressText) warnings.push("rawAddressText 缺失，正式上线前需确认地址是否只留在外部订单原文");
  if (sourceType === "FULFILLMENT" && mapped.deliveryStatus === "DELIVERED" && !mapped.deliveredAt) warnings.push("DELIVERED 缺少 deliveredAt，将由系统记录导入时间");
  if (sourceType === "WECHAT_LEAD" && !mapped.receiverPhone && !mapped.userId) warnings.push("缺少 receiverPhone/userId，导入后会进入线索人工匹配待办");
  return { errors, warnings };
}

function previewExternalSamples(data, sourceType, samples) {
  const type = normalizeSourceType(sourceType);
  const input = samplesFromBody(samples);
  const rows = input.rows.map((raw, index) => {
    const mappedRow = mapSampleRow(data, type, raw || {});
    const mapped = mappedRow.mapped;
    const { errors, warnings } = validateMappedRow(type, mapped);
    return {
      index: index + 1,
      sourceType: type,
      status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "READY",
      importable: errors.length === 0,
      mapped,
      fieldPresence: mappedRow.fieldPresence,
      errors,
      warnings,
    };
  });
  return {
    sourceType: type,
    inputType: input.inputType,
    total: rows.length,
    importableCount: rows.filter((row) => row.importable).length,
    errorCount: rows.filter((row) => row.errors.length).length,
    warningCount: rows.filter((row) => row.warnings.length).length,
    rows,
  };
}

function ensureSampleReviews(data) {
  if (!Array.isArray(data.externalSampleReviews)) data.externalSampleReviews = [];
  return data.externalSampleReviews;
}

function rate(present, total) {
  return total ? Math.round((present / total) * 100) : 0;
}

function buildFieldCoverage(sourceType, rows) {
  const fields = Object.keys(FIELD_ALIASES[sourceType] || {});
  return fields.reduce((coverage, field) => {
    const present = rows.filter((row) => {
      return row.fieldPresence ? Boolean(row.fieldPresence[field]) : Boolean(row.mapped && row.mapped[field]);
    }).length;
    coverage[field] = { present, total: rows.length, rate: rate(present, rows.length) };
    return coverage;
  }, {});
}

function aggregateErrorsByMessage(rows, matcher) {
  const counts = new Map();
  rows.forEach((row) => {
    (row.errors || []).forEach((message) => {
      if (!matcher(message)) return;
      counts.set(message, (counts.get(message) || 0) + 1);
    });
  });
  return Array.from(counts.entries()).map(([message, count]) => ({ message, count }));
}

function collectUnknownStatusValues(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const mapped = row.mapped || {};
    [
      ["deliveryStatus", mapped.deliveryStatus, VALID_DELIVERY_STATUSES],
      ["orderStatus", mapped.orderStatus, VALID_ORDER_STATUSES],
    ].forEach(([field, value, validValues]) => {
      if (!value || validValues.has(value)) return;
      const key = `${field}:${value}`;
      counts.set(key, { field, value, count: (counts.get(key) ? counts.get(key).count : 0) + 1 });
    });
  });
  return Array.from(counts.values());
}

function decisionStatus(result, unknownStatusValues) {
  if (unknownStatusValues.length) return "NEEDS_MAPPING";
  if (result.errorCount) return "BLOCKED";
  if (result.warningCount) return "NEEDS_REVIEW";
  return "READY";
}

function recordExternalSampleReview(data, mode, result) {
  const unknownStatusValues = collectUnknownStatusValues(result.rows || []);
  const review = {
    review_id: createId("rev"),
    mode,
    source_type: result.sourceType,
    input_type: result.inputType || "JSON",
    total: result.total || 0,
    importable_count: result.importableCount || 0,
    imported_count: result.importedCount || 0,
    error_count: result.errorCount || 0,
    warning_count: result.warningCount || 0,
    field_coverage: buildFieldCoverage(result.sourceType, result.rows || []),
    missing_required_fields: aggregateErrorsByMessage(result.rows || [], (message) => message.includes("缺失") || message.includes("至少需要一个")),
    unknown_status_values: unknownStatusValues,
    decision_status: decisionStatus(result, unknownStatusValues),
    created_at: nowISO(),
  };
  ensureSampleReviews(data).unshift(review);
  data.externalSampleReviews = ensureSampleReviews(data).slice(0, 30);
  return review;
}

function listExternalSampleReviews(data, limit = 10) {
  return ensureSampleReviews(data).slice(0, limit);
}

function latestReviewForSource(data, sourceType) {
  return ensureSampleReviews(data)
    .filter((review) => review.source_type === sourceType)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

function requiredCoverageGaps(sourceType, review) {
  const coverage = review && review.field_coverage ? review.field_coverage : {};
  return (REQUIRED_FIELDS[sourceType] || []).filter((field) => {
    const item = coverage[field] || {};
    return (item.rate || 0) < 100;
  });
}

function sourceReadiness(data, sourceType, requiredSamples) {
  const review = latestReviewForSource(data, sourceType);
  if (!review) {
    return {
      sourceType,
      label: SOURCE_LABELS[sourceType] || sourceType,
      status: "BLOCKED",
      latestReview: null,
      blockingReasons: [{ code: "NO_REVIEW", message: "还没有取样评审记录" }],
      warnings: [],
      nextAction: "先在后台粘贴真实导出样本并执行预览校验",
    };
  }

  const blockingReasons = [];
  const warnings = [];
  const coverageGaps = requiredCoverageGaps(sourceType, review);
  if (review.decision_status === "BLOCKED") {
    blockingReasons.push({ code: "REVIEW_BLOCKED", message: "最新评审存在缺失字段或无法定位的数据" });
  }
  if (review.decision_status === "NEEDS_MAPPING") {
    blockingReasons.push({ code: "NEEDS_MAPPING", message: "最新评审仍有未知状态枚举" });
  }
  if ((review.total || 0) < requiredSamples) {
    blockingReasons.push({ code: "INSUFFICIENT_SAMPLES", message: `最新评审样本数 ${review.total || 0}/${requiredSamples}` });
  }
  if (coverageGaps.length) {
    blockingReasons.push({ code: "REQUIRED_FIELD_COVERAGE", message: `必填字段覆盖不足：${coverageGaps.join(", ")}` });
  }
  if (review.decision_status === "NEEDS_REVIEW") {
    warnings.push({ code: "NEEDS_REVIEW", message: "最新评审有提醒项，需要运营/产品确认是否接受" });
  }

  const status = blockingReasons.length ? "BLOCKED" : warnings.length ? "NEEDS_REVIEW" : "READY";
  return {
    sourceType,
    label: SOURCE_LABELS[sourceType] || sourceType,
    status,
    latestReview: {
      reviewId: review.review_id,
      mode: review.mode,
      inputType: review.input_type,
      decisionStatus: review.decision_status,
      total: review.total || 0,
      importableCount: review.importable_count || 0,
      importedCount: review.imported_count || 0,
      warningCount: review.warning_count || 0,
      errorCount: review.error_count || 0,
      createdAt: review.created_at || "",
    },
    blockingReasons,
    warnings,
    nextAction: blockingReasons.length
      ? "补齐样本数量、状态映射或必填字段后重新预览"
      : warnings.length
        ? "确认提醒项是否可接受，再进入真实平台 Adapter 开发"
        : "可进入真实平台 Adapter 开发",
  };
}

function buildAdapterReadiness(data, options = {}) {
  const requiredSamples = Number(options.requiredSamples || 3);
  const sources = Object.values(SOURCE_TYPES).map((sourceType) => sourceReadiness(data, sourceType, requiredSamples));
  const summary = {
    ready: sources.filter((item) => item.status === "READY").length,
    needsReview: sources.filter((item) => item.status === "NEEDS_REVIEW").length,
    blocked: sources.filter((item) => item.status === "BLOCKED").length,
    total: sources.length,
  };
  return {
    requiredSamples,
    status: summary.blocked ? "BLOCKED" : summary.needsReview ? "NEEDS_REVIEW" : "READY",
    summary,
    sources,
  };
}

function sampleTemplateFor(sourceType) {
  const type = normalizeSourceType(sourceType);
  const template = SAMPLE_TEMPLATES[type];
  return {
    ...template,
    csvTemplate: [
      template.csvHeader,
      ...Array.from({ length: template.requiredSamples }, () => template.csvHeader.split(",").map(() => "").join(",")),
    ].join("\n"),
  };
}

function listSampleTemplates() {
  return Object.values(SOURCE_TYPES).map(sampleTemplateFor);
}

function validCanonicalValues(field) {
  if (field === "deliveryStatus") return VALID_DELIVERY_STATUSES;
  if (field === "orderStatus") return VALID_ORDER_STATUSES;
  return null;
}

function upsertStatusMapping(data, body = {}) {
  const sourceType = normalizeSourceType(body.sourceType || body.source_type || "ANY");
  const field = normalizeString(body.field);
  const rawValue = normalizeString(body.rawValue || body.raw_value);
  const canonicalValue = normalizeString(body.canonicalValue || body.canonical_value).toUpperCase();
  const validValues = validCanonicalValues(field);
  if (!validValues) throw sampleError(400, "只支持 deliveryStatus 或 orderStatus 映射");
  if (!rawValue) throw sampleError(400, "原始状态必填");
  if (!validValues.has(canonicalValue)) throw sampleError(400, "目标状态不在允许范围内");

  const mappings = ensureStatusMappings(data);
  let mapping = mappings.find((item) => item.source_type === sourceType && item.field === field && item.raw_value === rawValue);
  if (!mapping) {
    mapping = {
      mapping_id: createId("map"),
      source_type: sourceType,
      field,
      raw_value: rawValue,
      canonical_value: canonicalValue,
      note: "",
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    mappings.unshift(mapping);
  } else {
    mapping.canonical_value = canonicalValue;
    mapping.updated_at = nowISO();
  }
  mapping.note = body.note || mapping.note || "";
  return mapping;
}

function listStatusMappings(data, limit = 30) {
  return ensureStatusMappings(data).slice(0, limit);
}

function findUserIdByPhone(data, phone) {
  const receiverPhone = normalizePhone(phone);
  if (!receiverPhone) return "";
  const user = data.users.find((item) => normalizePhone(item.phone) === receiverPhone);
  if (user) return user.user_id;
  const link = data.identityLinks.find((item) => item.receiver_phone === receiverPhone);
  return link ? link.user_id : "";
}

function ensureLeadProfiles(data) {
  if (!Array.isArray(data.leadProfiles)) data.leadProfiles = [];
  return data.leadProfiles;
}

function upsertWechatLead(data, mapped, dateText = todayISO()) {
  const leadProfiles = ensureLeadProfiles(data);
  const userId = mapped.userId || findUserIdByPhone(data, mapped.receiverPhone);
  let lead = leadProfiles.find((item) => mapped.externalContactId && item.external_contact_id === mapped.externalContactId);
  if (!lead && userId) lead = leadProfiles.find((item) => item.user_id === userId);
  if (!lead) {
    lead = {
      lead_id: createId("lead"),
      user_id: userId,
      external_contact_id: mapped.externalContactId || "",
      wechat_remark_name: mapped.remarkName || "",
      source_channel: "",
      offline_event_name: "",
      corp_wechat_status: "UNKNOWN",
      rule_sent_at: "",
      operator_note: "",
      receiver_phone: mapped.receiverPhone || "",
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    leadProfiles.push(lead);
  }

  lead.user_id = userId || lead.user_id || "";
  lead.external_contact_id = mapped.externalContactId || lead.external_contact_id || "";
  lead.wechat_remark_name = mapped.remarkName || lead.wechat_remark_name || "";
  lead.source_channel = mapped.sourceChannel || lead.source_channel || "";
  lead.offline_event_name = mapped.offlineEventName || lead.offline_event_name || "";
  lead.corp_wechat_status = mapped.corpWechatStatus || lead.corp_wechat_status || "UNKNOWN";
  lead.operator_note = mapped.operatorNote || lead.operator_note || "";
  lead.receiver_phone = mapped.receiverPhone || lead.receiver_phone || "";
  lead.updated_at = nowISO();

  let task = null;
  if (!lead.user_id) {
    task = operationTask.createOperationTaskOnce(data, {
      task_type: "LEAD_NEEDS_MATCHING",
      task_date: dateText,
      dedupe_key: lead.external_contact_id || lead.wechat_remark_name || lead.receiver_phone || lead.lead_id,
      reason: "企业微信线索未匹配到小程序用户",
      suggested_action: "用收货手机号、备注名或有赞订单进行人工匹配",
      metadata: { leadId: lead.lead_id, externalContactId: lead.external_contact_id, remarkName: lead.wechat_remark_name },
    }).task;
  }
  return { lead, task };
}

function importMappedRow(data, sourceType, mapped, dateText) {
  if (sourceType === "YOUZAN_ORDER") {
    const order = orderFulfillment.syncManualOrder(data, mapped);
    return { order: orderFulfillment.toOrderPayload(data, order) };
  }
  if (sourceType === "FULFILLMENT") {
    const result = orderFulfillment.updateOrderFulfillment(data, mapped, dateText);
    return { order: orderFulfillment.toOrderPayload(data, result.order), fulfillment: result.fulfillment, task: result.task };
  }
  if (sourceType === "WECHAT_LEAD") {
    return upsertWechatLead(data, mapped, dateText);
  }
  throw sampleError(400, "未知样本来源");
}

function importExternalSamples(data, sourceType, samples, dateText = todayISO()) {
  const preview = previewExternalSamples(data, sourceType, samples);
  const rows = preview.rows.map((row) => {
    if (!row.importable) return { ...row, imported: false, result: null };
    try {
      return {
        ...row,
        status: row.warnings.length ? "IMPORTED_WITH_WARNING" : "IMPORTED",
        imported: true,
        result: importMappedRow(data, preview.sourceType, row.mapped, dateText),
      };
    } catch (error) {
      return {
        ...row,
        status: "ERROR",
        imported: false,
        result: null,
        errors: [...row.errors, error.message],
      };
    }
  });
  return {
    sourceType: preview.sourceType,
    inputType: preview.inputType,
    total: rows.length,
    importableCount: preview.importableCount,
    importedCount: rows.filter((row) => row.imported).length,
    errorCount: rows.filter((row) => row.errors.length).length,
    warningCount: rows.filter((row) => row.warnings.length).length,
    rows,
  };
}

module.exports = {
  buildAdapterReadiness,
  importExternalSamples,
  listExternalSampleReviews,
  listSampleTemplates,
  listStatusMappings,
  parseTabularText,
  previewExternalSamples,
  recordExternalSampleReview,
  SOURCE_TYPES,
  sampleTemplateFor,
  upsertStatusMapping,
};
