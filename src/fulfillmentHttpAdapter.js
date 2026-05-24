function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMethod(value) {
  return String(value || "POST").toUpperCase() === "GET" ? "GET" : "POST";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw adapterError(400, `物流 Adapter 配置不是合法 JSON：${error.message}`);
  }
}

function getPath(source, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function firstDefined(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstArray(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeFieldMap(env) {
  const fieldMap = parseJsonEnv(env.ROOT_FULFILLMENT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function mapFulfillmentEvent(record, fieldMap) {
  return {
    orderId: valueFor(record, fieldMap, "orderId", ["orderId", "order_id"]),
    youzanOrderNo: valueFor(record, fieldMap, "youzanOrderNo", ["youzanOrderNo", "youzan_order_no", "orderNo", "order_no", "tid", "trade_no", "tradeNo"]),
    receiverName: valueFor(record, fieldMap, "receiverName", ["receiverName", "receiver_name", "receiver.name", "receiverInfo.name", "receiver_info.name"]),
    receiverPhone: valueFor(record, fieldMap, "receiverPhone", ["receiverPhone", "receiver_phone", "receiver.mobile", "receiver.phone", "receiverInfo.mobile", "receiver_info.mobile", "receiver_tel", "receiver_mobile", "phone"]),
    carrier: valueFor(record, fieldMap, "carrier", ["carrier", "carrier_name", "express_company", "logistics_company", "company", "shipper"]),
    trackingNo: valueFor(record, fieldMap, "trackingNo", ["trackingNo", "tracking_no", "express_no", "logistics_no", "waybill_no", "waybillNo"]),
    deliveryStatus: valueFor(record, fieldMap, "deliveryStatus", ["deliveryStatus", "delivery_status", "status", "logistics_status", "express_status"]),
    shippedAt: valueFor(record, fieldMap, "shippedAt", ["shippedAt", "shipped_at", "ship_time", "shipped_time", "send_time"]),
    deliveredAt: valueFor(record, fieldMap, "deliveredAt", ["deliveredAt", "delivered_at", "signed_at", "sign_time", "delivered_time"]),
    lastEventText: valueFor(record, fieldMap, "lastEventText", ["lastEventText", "last_event_text", "latest_trace", "latest_status", "description", "desc", "message"]),
  };
}

function applySecret(env, url, headers, params) {
  const secret = env.ROOT_FULFILLMENT_SECRET;
  const location = String(env.ROOT_FULFILLMENT_SECRET_LOCATION || "header").toLowerCase();
  const headerName = env.ROOT_FULFILLMENT_SECRET_HEADER || "X-Root-Fulfillment-Secret";
  const paramName = env.ROOT_FULFILLMENT_SECRET_PARAM || "secret";
  if (location === "query") {
    url.searchParams.set(paramName, secret);
    return;
  }
  if (location === "body") {
    params[paramName] = secret;
    return;
  }
  headers[headerName] = secret;
}

function buildRequest(env, cursor, limit) {
  const url = new URL(env.ROOT_FULFILLMENT_LIST_URL);
  const method = normalizeMethod(env.ROOT_FULFILLMENT_LIST_METHOD);
  const limitParam = env.ROOT_FULFILLMENT_LIST_LIMIT_PARAM || "page_size";
  const cursorParam = env.ROOT_FULFILLMENT_LIST_CURSOR_PARAM || "cursor";
  const params = {
    ...parseJsonEnv(env.ROOT_FULFILLMENT_LIST_EXTRA_PARAMS, {}),
    [limitParam]: limit,
  };
  if (cursor) params[cursorParam] = cursor;

  const headers = { Accept: "application/json" };
  applySecret(env, url, headers, params);
  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return { url, init: { method, headers } };
  }
  headers["Content-Type"] = "application/json";
  return { url, init: { method, headers, body: JSON.stringify(params) } };
}

async function readResponseJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw adapterError(502, `物流状态响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `物流状态拉取失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeFulfillmentPayload(payload, env, fieldMap) {
  const records = firstArray(payload, [
    env.ROOT_FULFILLMENT_LIST_DATA_PATH,
    "data.items",
    "data.events",
    "data.list",
    "response.items",
    "response.events",
    "items",
    "events",
    "list",
    "records",
    "data",
  ].filter(Boolean));
  const cursorAfter = firstDefined(payload, [
    env.ROOT_FULFILLMENT_LIST_CURSOR_PATH,
    "data.next_cursor",
    "data.nextCursor",
    "data.next_page_token",
    "response.next_cursor",
    "next_cursor",
    "nextCursor",
    "cursor",
  ].filter(Boolean)) || "";
  const hasMoreValue = firstDefined(payload, [
    env.ROOT_FULFILLMENT_LIST_HAS_MORE_PATH,
    "data.has_more",
    "data.hasMore",
    "response.has_more",
    "has_more",
    "hasMore",
  ].filter(Boolean));
  return {
    samples: records.map((record) => mapFulfillmentEvent(record, fieldMap)),
    externalCount: records.length,
    nextCursor: cursorAfter,
    hasMore: hasMoreValue === undefined ? Boolean(cursorAfter) : Boolean(hasMoreValue),
  };
}

function createFulfillmentImplementation(options = {}) {
  return async function fetchFulfillmentEvents(context) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.ROOT_FULFILLMENT_LIST_URL) throw adapterError(400, "物流状态 Adapter 缺少 ROOT_FULFILLMENT_LIST_URL");
    if (!env.ROOT_FULFILLMENT_SECRET) throw adapterError(400, "物流状态 Adapter 缺少 ROOT_FULFILLMENT_SECRET");
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context.cursor, context.limit);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeFulfillmentPayload(payload, env, fieldMap);
  };
}

module.exports = {
  createFulfillmentImplementation,
  mapFulfillmentEvent,
};
