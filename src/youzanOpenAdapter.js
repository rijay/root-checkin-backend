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
    throw adapterError(400, `有赞 Adapter 配置不是合法 JSON：${error.message}`);
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
  const fieldMap = parseJsonEnv(env.YOUZAN_ORDER_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function mapYouzanOrder(record, fieldMap) {
  return {
    youzanOrderNo: valueFor(record, fieldMap, "youzanOrderNo", ["youzanOrderNo", "youzan_order_no", "orderNo", "order_no", "tid", "id"]),
    receiverName: valueFor(record, fieldMap, "receiverName", ["receiverName", "receiver_name", "receiver.name", "receiver_name", "receiverInfo.name", "receiver_info.name"]),
    receiverPhone: valueFor(record, fieldMap, "receiverPhone", ["receiverPhone", "receiver_phone", "receiver.mobile", "receiver.phone", "receiverInfo.mobile", "receiver_info.mobile", "receiver_tel", "receiver_mobile", "phone"]),
    productName: valueFor(record, fieldMap, "productName", ["productName", "product_name", "items.0.title", "orders.0.title", "full_order_info.orders.0.title"]),
    productId: valueFor(record, fieldMap, "productId", ["productId", "product_id", "items.0.item_id", "orders.0.item_id", "full_order_info.orders.0.item_id"]),
    amount: valueFor(record, fieldMap, "amount", ["amount", "payAmount", "pay_amount", "payment", "price", "total_fee", "full_order_info.pay_info.payment"]),
    paidAt: valueFor(record, fieldMap, "paidAt", ["paidAt", "paid_at", "payTime", "pay_time", "created", "full_order_info.pay_info.pay_time"]),
    orderStatus: valueFor(record, fieldMap, "orderStatus", ["orderStatus", "order_status", "status", "full_order_info.order_info.status"]),
    deliveryStatus: valueFor(record, fieldMap, "deliveryStatus", ["deliveryStatus", "delivery_status", "shipping_status", "full_order_info.delivery_order.0.status"]),
    rawAddressText: valueFor(record, fieldMap, "rawAddressText", ["rawAddressText", "raw_address_text", "receiver.address", "receiverInfo.address", "receiver_info.address", "address"]),
  };
}

function buildRequest(env, cursor, limit) {
  const url = new URL(env.YOUZAN_ORDER_LIST_URL);
  const method = normalizeMethod(env.YOUZAN_ORDER_LIST_METHOD);
  const limitParam = env.YOUZAN_ORDER_LIST_LIMIT_PARAM || "page_size";
  const cursorParam = env.YOUZAN_ORDER_LIST_CURSOR_PARAM || "cursor";
  const tokenParam = env.YOUZAN_ACCESS_TOKEN_PARAM || "access_token";
  const tokenLocation = String(env.YOUZAN_ACCESS_TOKEN_LOCATION || "query").toLowerCase();
  const params = {
    ...parseJsonEnv(env.YOUZAN_ORDER_LIST_EXTRA_PARAMS, {}),
    [limitParam]: limit,
  };
  if (cursor) params[cursorParam] = cursor;

  const headers = { Accept: "application/json" };
  if (env.YOUZAN_ACCESS_TOKEN && tokenLocation === "query") {
    url.searchParams.set(tokenParam, env.YOUZAN_ACCESS_TOKEN);
  }
  if (env.YOUZAN_ACCESS_TOKEN && tokenLocation === "header") {
    headers.Authorization = `Bearer ${env.YOUZAN_ACCESS_TOKEN}`;
  }
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
    throw adapterError(502, `有赞订单响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `有赞订单拉取失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeYouzanPayload(payload, env, fieldMap) {
  const records = firstArray(payload, [
    env.YOUZAN_ORDER_LIST_DATA_PATH,
    "data.items",
    "data.list",
    "data.trades",
    "response.items",
    "response.trades",
    "items",
    "list",
    "trades",
    "records",
    "data",
  ].filter(Boolean));
  const cursorAfter = firstDefined(payload, [
    env.YOUZAN_ORDER_LIST_CURSOR_PATH,
    "data.next_cursor",
    "data.nextCursor",
    "data.next_page_token",
    "response.next_cursor",
    "next_cursor",
    "nextCursor",
    "cursor",
  ].filter(Boolean)) || "";
  const hasMoreValue = firstDefined(payload, [
    env.YOUZAN_ORDER_LIST_HAS_MORE_PATH,
    "data.has_more",
    "data.hasMore",
    "response.has_more",
    "has_more",
    "hasMore",
  ].filter(Boolean));
  return {
    samples: records.map((record) => mapYouzanOrder(record, fieldMap)),
    externalCount: records.length,
    nextCursor: cursorAfter,
    hasMore: hasMoreValue === undefined ? Boolean(cursorAfter) : Boolean(hasMoreValue),
  };
}

function createYouzanOrderImplementation(options = {}) {
  return async function fetchYouzanOrders(context) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.YOUZAN_ORDER_LIST_URL) throw adapterError(400, "有赞订单 Adapter 缺少 YOUZAN_ORDER_LIST_URL");
    if (!env.YOUZAN_ACCESS_TOKEN) throw adapterError(400, "有赞订单 Adapter 缺少 YOUZAN_ACCESS_TOKEN");
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context.cursor, context.limit);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeYouzanPayload(payload, env, fieldMap);
  };
}

module.exports = {
  createYouzanOrderImplementation,
  mapYouzanOrder,
};
