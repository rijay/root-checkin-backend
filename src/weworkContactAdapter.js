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
    throw adapterError(400, `企业微信 Adapter 配置不是合法 JSON：${error.message}`);
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
  const fieldMap = parseJsonEnv(env.WEWORK_CONTACT_FIELD_MAP, {});
  return Object.entries(fieldMap).reduce((next, [field, paths]) => {
    next[field] = Array.isArray(paths) ? paths : [paths];
    return next;
  }, {});
}

function valueFor(record, fieldMap, field, fallbackPaths) {
  return firstDefined(record, fieldMap[field] || fallbackPaths) || "";
}

function mapWeworkContact(record, fieldMap) {
  return {
    userId: valueFor(record, fieldMap, "userId", ["userId", "user_id", "unionid", "openid"]),
    receiverPhone: valueFor(record, fieldMap, "receiverPhone", ["receiverPhone", "receiver_phone", "phone", "mobile", "remark_mobiles.0", "phones.0", "customer.mobile", "profile.mobile"]),
    externalContactId: valueFor(record, fieldMap, "externalContactId", ["externalContactId", "external_contact_id", "external_userid", "external_user_id", "userid", "id"]),
    remarkName: valueFor(record, fieldMap, "remarkName", ["remarkName", "remark_name", "remark", "name", "nickname", "customer.name", "profile.name"]),
    sourceChannel: valueFor(record, fieldMap, "sourceChannel", ["sourceChannel", "source_channel", "source", "add_way", "channel", "source_from"]),
    offlineEventName: valueFor(record, fieldMap, "offlineEventName", ["offlineEventName", "offline_event_name", "activity", "activity_name", "event_name", "campaign"]),
    corpWechatStatus: valueFor(record, fieldMap, "corpWechatStatus", ["corpWechatStatus", "corp_wechat_status", "status", "contact_status", "follow_status", "state", "add_status"]),
    operatorNote: valueFor(record, fieldMap, "operatorNote", ["operatorNote", "operator_note", "note", "description", "memo", "remark_text"]),
  };
}

function applyToken(env, url, headers) {
  const token = env.WEWORK_CONTACT_ACCESS_TOKEN || env.WEWORK_ACCESS_TOKEN || "";
  if (!token) return false;
  const tokenLocation = String(env.WEWORK_ACCESS_TOKEN_LOCATION || env.WEWORK_CONTACT_TOKEN_LOCATION || "query").toLowerCase();
  const tokenParam = env.WEWORK_ACCESS_TOKEN_PARAM || env.WEWORK_CONTACT_TOKEN_PARAM || "access_token";
  if (tokenLocation === "header") {
    headers.Authorization = `Bearer ${token}`;
    return true;
  }
  url.searchParams.set(tokenParam, token);
  return true;
}

function applySecret(env, url, headers, params, hasToken) {
  const secret = env.WEWORK_CONTACT_SECRET;
  const location = String(env.WEWORK_CONTACT_SECRET_LOCATION || (hasToken ? "none" : "header")).toLowerCase();
  if (!secret || location === "none") return;
  const headerName = env.WEWORK_CONTACT_SECRET_HEADER || "X-WeWork-Contact-Secret";
  const paramName = env.WEWORK_CONTACT_SECRET_PARAM || "secret";
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
  const url = new URL(env.WEWORK_CONTACT_LIST_URL);
  const method = normalizeMethod(env.WEWORK_CONTACT_LIST_METHOD);
  const limitParam = env.WEWORK_CONTACT_LIST_LIMIT_PARAM || "page_size";
  const cursorParam = env.WEWORK_CONTACT_LIST_CURSOR_PARAM || "cursor";
  const params = {
    ...parseJsonEnv(env.WEWORK_CONTACT_LIST_EXTRA_PARAMS, {}),
    [limitParam]: limit,
  };
  if (cursor) params[cursorParam] = cursor;
  if (env.WEWORK_CORP_ID_PARAM && env.WEWORK_CORP_ID) params[env.WEWORK_CORP_ID_PARAM] = env.WEWORK_CORP_ID;

  const headers = { Accept: "application/json" };
  const hasToken = applyToken(env, url, headers);
  applySecret(env, url, headers, params, hasToken);
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
    throw adapterError(502, `企业微信线索响应不是合法 JSON：${error.message}`);
  }
  if (!response.ok) {
    throw adapterError(response.status || 502, `企业微信线索拉取失败：HTTP ${response.status}`, payload);
  }
  return payload;
}

function normalizeWeworkPayload(payload, env, fieldMap) {
  const records = firstArray(payload, [
    env.WEWORK_CONTACT_LIST_DATA_PATH,
    "data.items",
    "data.contacts",
    "data.external_contacts",
    "response.items",
    "response.contacts",
    "items",
    "contacts",
    "external_contacts",
    "list",
    "records",
    "data",
  ].filter(Boolean));
  const cursorAfter = firstDefined(payload, [
    env.WEWORK_CONTACT_LIST_CURSOR_PATH,
    "data.next_cursor",
    "data.nextCursor",
    "data.next_page_token",
    "response.next_cursor",
    "next_cursor",
    "nextCursor",
    "cursor",
  ].filter(Boolean)) || "";
  const hasMoreValue = firstDefined(payload, [
    env.WEWORK_CONTACT_LIST_HAS_MORE_PATH,
    "data.has_more",
    "data.hasMore",
    "response.has_more",
    "has_more",
    "hasMore",
  ].filter(Boolean));
  return {
    samples: records.map((record) => mapWeworkContact(record, fieldMap)),
    externalCount: records.length,
    nextCursor: cursorAfter,
    hasMore: hasMoreValue === undefined ? Boolean(cursorAfter) : Boolean(hasMoreValue),
  };
}

function createWeworkContactImplementation(options = {}) {
  return async function fetchWeworkContacts(context) {
    const env = context.env || {};
    const fetchImpl = options.fetchImpl || context.fetchImpl || globalThis.fetch;
    if (!env.WEWORK_CONTACT_LIST_URL) throw adapterError(400, "企业微信线索 Adapter 缺少 WEWORK_CONTACT_LIST_URL");
    if (!env.WEWORK_CONTACT_SECRET && !env.WEWORK_CONTACT_ACCESS_TOKEN && !env.WEWORK_ACCESS_TOKEN) {
      throw adapterError(400, "企业微信线索 Adapter 缺少 WEWORK_CONTACT_SECRET 或 WEWORK_ACCESS_TOKEN");
    }
    if (typeof fetchImpl !== "function") throw adapterError(500, "当前 Node 环境没有可用 fetch Implementation");

    const fieldMap = normalizeFieldMap(env);
    const request = buildRequest(env, context.cursor, context.limit);
    const response = await fetchImpl(request.url, request.init);
    const payload = await readResponseJson(response);
    return normalizeWeworkPayload(payload, env, fieldMap);
  };
}

module.exports = {
  createWeworkContactImplementation,
  mapWeworkContact,
};
