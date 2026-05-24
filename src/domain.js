const crypto = require("node:crypto");
const { addDays, daysBetween, nowISO, todayISO } = require("./dates");
const adapterCalibration = require("./adapterCalibration");
const adminOrderMatching = require("./adminOrderMatching");
const adminOpsPresenter = require("./adminOpsPresenter");
const adminUserPresenter = require("./adminUserPresenter");
const coupon = require("./coupon");
const externalAdapterSamples = require("./externalAdapterSamples");
const externalPlatformAdapters = require("./externalPlatformAdapters");
const { getHomeViewModel } = require("./flowView");
const { identifyUser, normalizePhone } = require("./identity");
const launchReadiness = require("./launchReadiness");
const operationTask = require("./operationTask");
const orderFulfillment = require("./orderFulfillment");
const questionnaire = require("./questionnaire");
const releaseRecord = require("./releaseRecord");
const refundWorkItem = require("./refundWorkItem");
const { createId, createSeedData } = require("./seed");

const STATES = {
  GUEST: "GUEST",
  UNREGISTERED: "UNREGISTERED",
  REGISTERED_IDLE: "REGISTERED_IDLE",
  CHECKIN_ACTIVE: "CHECKIN_ACTIVE",
  CHECKIN_COMPLETED: "CHECKIN_COMPLETED",
  CHECKIN_FAILED: "CHECKIN_FAILED",
  DAILY_USER: "DAILY_USER",
};

const ROUTES_BY_STATE = {
  GUEST: "/pages/home/index",
  UNREGISTERED: "/pages/home/index",
  REGISTERED_IDLE: "/pages/home/index",
  CHECKIN_ACTIVE: "/pages/home/index",
  CHECKIN_COMPLETED: "/pages/home/index",
  CHECKIN_FAILED: "/pages/home/index",
  DAILY_USER: "/pages/home/index",
};

const ROUTE_PERMISSIONS = {
  "/pages/login/index": [STATES.GUEST],
  "/pages/register/index": [STATES.UNREGISTERED],
  "/pages/activity/index": [STATES.REGISTERED_IDLE],
  "/pages/order/match": [STATES.REGISTERED_IDLE],
  "/pages/home/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/today/index": [STATES.CHECKIN_ACTIVE, STATES.DAILY_USER],
  "/subpkg/checkin/pages/history/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/result/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/share-poster/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/questionnaire/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED],
  "/subpkg/refund/pages/apply/index": [STATES.CHECKIN_COMPLETED],
  "/subpkg/refund/pages/status/index": [STATES.CHECKIN_COMPLETED, STATES.DAILY_USER],
  "/subpkg/profile/pages/tags/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/orders/index": [STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/about/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/support/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/profile/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
};

const profileQuestions = [
  {
    field: "joinReasons",
    type: "multi",
    title: "参与本次试饮的原因",
    options: [
      { value: "health", label: "饮食健康/便型调理" },
      { value: "gut_flora", label: "肠道菌群改善" },
      { value: "skin", label: "皮肤/情绪/睡眠改善" },
      { value: "none", label: "没有特殊原因", exclusive: true },
    ],
  },
  {
    field: "gutHealthStatus",
    type: "single",
    title: "您的肠道健康状况",
    options: [
      { value: "good", label: "良好，无明显问题" },
      { value: "normal", label: "一般，偶尔有问题" },
      { value: "poor", label: "较差，经常有问题" },
      { value: "very_poor", label: "很差，长期困扰" },
    ],
  },
  {
    field: "improvementMethods",
    type: "multi",
    title: "您目前肠道健康改善的方式",
    options: [
      { value: "diet", label: "调整饮食结构" },
      { value: "exercise", label: "规律运动" },
      { value: "probiotics", label: "服用益生菌/益生元" },
      { value: "medical", label: "看医生/吃药" },
      { value: "none", label: "暂未采取任何方式", exclusive: true },
    ],
  },
  {
    field: "stoolType",
    type: "stool",
    title: "便便日常是什么类型",
    options: [
      { value: "type1", label: "第一型：分散硬球，难排便" },
      { value: "type2", label: "第二型：腊肠状但表面凹凸" },
      { value: "type3", label: "第三型：腊肠状但表面有裂痕" },
      { value: "type4", label: "第四型：光滑柔软的腊肠状" },
      { value: "type5", label: "第五型：断边光滑的柔软块状" },
      { value: "type6", label: "第六型：粗边蓬松糊状" },
      { value: "type7", label: "第七型：水状无固体" },
    ],
  },
];

function createStore() {
  return createSeedData();
}

function getWechatConfig(env = process.env) {
  return {
    appid: env.WECHAT_APPID || env.WX_APPID || "",
    secret: env.WECHAT_APPSECRET || env.WECHAT_SECRET || env.WX_SECRET || "",
  };
}

function isDirectPhoneLoginAllowed(env = process.env) {
  return String(env.ROOT_ALLOW_DIRECT_PHONE_LOGIN || "").toLowerCase() === "true";
}

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function publicUser(user) {
  if (!user) return { state: STATES.GUEST };
  return {
    userId: user.user_id,
    phone: maskPhone(user.phone),
    state: user.state,
    nickname: user.nickname || "ROOT用户",
    avatarUrl: user.avatar_url || "",
    totalCheckinDays: user.total_checkin_days || 0,
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    lastCheckinDate: user.last_checkin_date || "",
  };
}

function issueToken(data, userId) {
  const token = `root_${crypto.randomBytes(18).toString("hex")}`;
  data.tokens[token] = userId;
  return token;
}

function findUserByToken(data, token) {
  const userId = data.tokens[token];
  if (!userId) return null;
  return data.users.find((user) => user.user_id === userId) || null;
}

function requireUser(data, token) {
  const user = findUserByToken(data, token);
  if (!user) {
    const error = new Error("登录已过期，请重新登录");
    error.code = 1003;
    error.status = 401;
    throw error;
  }
  return user;
}

function response(data) {
  return { code: 0, message: "ok", data };
}

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function fetchWechatJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    const message = payload.errmsg || `微信接口请求失败：${response.status}`;
    throw businessError(1006, message);
  }
  return payload;
}

async function getWechatAccessToken(data, config) {
  const cached = data.wechatAccessToken;
  if (cached && cached.token && cached.expires_at > Date.now() + 60 * 1000) return cached.token;

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.appid);
  url.searchParams.set("secret", config.secret);
  const payload = await fetchWechatJson(url);
  data.wechatAccessToken = {
    token: payload.access_token,
    expires_at: Date.now() + Math.max(300, Number(payload.expires_in || 7200) - 300) * 1000,
  };
  return data.wechatAccessToken.token;
}

async function getWechatPhoneNumber(data, config, phoneCode) {
  const accessToken = await getWechatAccessToken(data, config);
  const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  url.searchParams.set("access_token", accessToken);
  const payload = await fetchWechatJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: phoneCode }),
  });
  const phoneInfo = payload.phone_info || {};
  return normalizePhone(phoneInfo.phoneNumber || phoneInfo.purePhoneNumber);
}

async function getWechatSession(config, wxCode) {
  if (!wxCode) return {};
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", config.appid);
  url.searchParams.set("secret", config.secret);
  url.searchParams.set("js_code", wxCode);
  url.searchParams.set("grant_type", "authorization_code");
  return fetchWechatJson(url);
}

function currentSessionForUser(data, userId) {
  return data.checkinSessions.find((session) => {
    return session.user_id === userId && ["ACTIVE", "COMPLETED", "FAILED", "REFUNDED"].includes(session.status);
  }) || null;
}

function currentActiveSession(data, userId) {
  return data.checkinSessions.find((session) => session.user_id === userId && session.status === "ACTIVE") || null;
}

function getRecords(data, sessionId) {
  return data.checkinRecords
    .filter((record) => record.session_id === sessionId)
    .sort((left, right) => left.day_index - right.day_index);
}

function toSessionPayload(data, session, dateText = todayISO()) {
  if (!session) return null;
  const records = Array.from({ length: 7 }, (_, index) => {
    const dayIndex = index + 1;
    const record = data.checkinRecords.find((item) => item.session_id === session.session_id && item.day_index === dayIndex);
    return {
      dayIndex,
      checkedIn: Boolean(record),
      date: addDays(session.start_date, index),
      isMakeup: Boolean(record && record.is_makeup),
      recordId: record ? record.record_id : "",
    };
  });
  return {
    sessionId: session.session_id,
    userId: session.user_id,
    startDate: session.start_date,
    endDate: session.end_date,
    currentDayIndex: Math.min(7, Math.max(1, daysBetween(session.start_date, dateText) + 1)),
    todayChecked: records.some((record) => record.date === dateText && record.checkedIn),
    status: session.status,
    missCount: session.miss_count,
    refundStatus: session.refund_status || null,
    orderId: session.order_id || null,
    records,
  };
}

function loginByPhone(data, body, phone) {
  if (!phone) throw businessError(1002, "手机号必填");

  let user = data.users.find((item) => item.phone === phone);
  if (!user) {
    user = {
      user_id: createId("usr"),
      openid: body.openid || "",
      unionid: body.unionid || "",
      phone,
      nickname: body.nickname || "ROOT体验官",
      avatar_url: "",
      state: STATES.UNREGISTERED,
      created_at: nowISO(),
      registered_at: "",
      activated_at: "",
      completed_at: "",
      total_checkin_days: 0,
      current_streak: 0,
      longest_streak: 0,
      last_checkin_date: "",
    };
    data.users.push(user);
  } else {
    if (body.openid && !user.openid) user.openid = body.openid;
    if (body.unionid && !user.unionid) user.unionid = body.unionid;
  }

  const token = issueToken(data, user.user_id);
  return response({ token, user: publicUser(user), nextRoute: ROUTES_BY_STATE[user.state] });
}

function login(data, body = {}) {
  const phone = normalizePhone(body.phone);
  return loginByPhone(data, body, phone);
}

async function loginWithWechat(data, body = {}, env = process.env) {
  const shouldUseWechatPhone = !body.phone && body.phoneCode;
  if (!shouldUseWechatPhone) {
    if (!isDirectPhoneLoginAllowed(env)) throw businessError(1007, "请使用微信手机号授权登录");
    return login(data, body);
  }

  const config = getWechatConfig(env);
  if (!config.appid || !config.secret) throw businessError(1006, "服务端未配置微信登录密钥");

  const [session, phone] = await Promise.all([
    getWechatSession(config, body.wxCode),
    getWechatPhoneNumber(data, config, body.phoneCode),
  ]);
  return loginByPhone(data, { ...body, openid: session.openid, unionid: session.unionid }, phone);
}

function getUserState(data, token) {
  const user = requireUser(data, token);
  const homeView = getHomeViewModel(data, user.user_id, todayISO());
  return response({
    user: publicUser(user),
    flowView: homeView.flowView,
    allowedActions: homeView.allowedActions,
    homeView,
    route: ROUTES_BY_STATE[user.state] || ROUTES_BY_STATE.GUEST,
    routePermissions: ROUTE_PERMISSIONS,
  });
}

function getProfile(data, token) {
  const user = requireUser(data, token);
  const profile = data.profiles.find((item) => item.user_id === user.user_id) || null;
  return response({ profile, questions: profileQuestions });
}

function getUserOrders(data, token) {
  const user = requireUser(data, token);
  const orders = data.youzanOrders.filter((order) => order.user_id === user.user_id).map((order) => orderFulfillment.toOrderPayload(data, order));
  return response({ orders });
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function fulfillmentForOrder(data, orderId) {
  return ensureList(data, "orderFulfillments").find((item) => item.order_id === orderId) || null;
}

function ensureFulfillment(data, order) {
  let fulfillment = fulfillmentForOrder(data, order.order_id);
  if (fulfillment) return fulfillment;
  fulfillment = {
    fulfillment_id: createId("ful"),
    order_id: order.order_id,
    receiver_name: order.receiver_name || "",
    receiver_phone: order.receiver_phone || order.phone || "",
    carrier: "",
    tracking_no: "",
    delivery_status: order.delivery_status || "NOT_SHIPPED",
    shipped_at: "",
    delivered_at: "",
    last_event_text: "",
    updated_at: nowISO(),
  };
  ensureList(data, "orderFulfillments").push(fulfillment);
  return fulfillment;
}

function getOrderDeliveryStatus(data, order) {
  const fulfillment = fulfillmentForOrder(data, order.order_id);
  return (fulfillment && fulfillment.delivery_status) || order.delivery_status || "NOT_SHIPPED";
}

function toOrderPayload(data, order) {
  const fulfillment = ensureFulfillment(data, order);
  const deliveryStatus = getOrderDeliveryStatus(data, order);
  return {
    orderId: order.order_id,
    youzanOrderNo: order.youzan_order_no,
    productName: order.product_name || order.product_id,
    orderStatus: order.order_status || "PAID",
    deliveryStatus,
    receiverPhone: maskPhone(order.receiver_phone || order.phone),
    receiverName: order.receiver_name || "",
    amount: order.amount,
    matchedAt: order.matched_at || "",
    fulfillment: {
      carrier: fulfillment.carrier || "",
      trackingNo: fulfillment.tracking_no || "",
      shippedAt: fulfillment.shipped_at || "",
      deliveredAt: fulfillment.delivered_at || "",
      lastEventText: fulfillment.last_event_text || "",
    },
  };
}

function validateProfile(body) {
  const listFields = ["joinReasons", "improvementMethods"];
  listFields.forEach((field) => {
    if (!Array.isArray(body[field]) || body[field].length === 0) {
      throw businessError(2001, "注册问卷信息不完整");
    }
  });
  if (!body.gutHealthStatus || !body.stoolType) {
    throw businessError(2001, "注册问卷信息不完整");
  }
}

function submitProfile(data, token, body) {
  const user = requireUser(data, token);
  validateProfile(body);
  const existing = data.profiles.find((item) => item.user_id === user.user_id);
  const profile = {
    profile_id: existing ? existing.profile_id : createId("pro"),
    user_id: user.user_id,
    join_reasons: body.joinReasons,
    gut_health_status: body.gutHealthStatus,
    improvement_methods: body.improvementMethods,
    stool_type: body.stoolType,
    submitted_at: nowISO(),
  };
  if (existing) Object.assign(existing, profile);
  else data.profiles.push(profile);

  if (user.state === STATES.UNREGISTERED) {
    user.state = STATES.REGISTERED_IDLE;
    user.registered_at = profile.submitted_at;
  }
  return response({ success: true, user: publicUser(user), profile });
}

function ensureCanActivate(user) {
  if (user.state !== STATES.REGISTERED_IDLE) {
    throw businessError(403, "当前状态不可启动打卡", 403);
  }
}

function createCheckinSession(data, user, orderId, source, dateText = todayISO()) {
  const active = currentActiveSession(data, user.user_id);
  if (active) return active;
  const session = {
    session_id: createId("ses"),
    user_id: user.user_id,
    order_id: orderId || "",
    start_date: dateText,
    end_date: addDays(dateText, 6),
    status: "ACTIVE",
    miss_count: 0,
    audited_miss_days: [],
    refund_status: null,
    created_at: nowISO(),
    source,
  };
  data.checkinSessions.push(session);
  user.state = STATES.CHECKIN_ACTIVE;
  user.activated_at = nowISO();
  return session;
}

function createManualReviewTask(data, user, reason, dateText = todayISO(), orderId = "") {
  return operationTask.createOperationTaskOnce(data, {
    task_type: "MANUAL_REVIEW_REQUIRED",
    user_id: user.user_id,
    order_id: orderId,
    task_date: dateText,
    reason,
    suggested_action: "通过企业微信确认订单、物流或启动资格",
  }).task;
}

function matchOrder(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  ensureCanActivate(user);
  const phone = normalizePhone(body.phone);
  if (!phone) throw businessError(1002, "手机号必填");
  const identity = identifyUser(data, user, { phone, leadHint: body.leadHint });

  const order = data.youzanOrders.find((item) => normalizePhone(item.receiver_phone || item.phone) === phone);
  if (!order) {
    createManualReviewTask(data, user, "未匹配到收货手机号对应的订单", dateText);
    throw businessError(3001, "未匹配到订单，已进入人工确认");
  }
  if (order.user_id && order.user_id !== user.user_id) {
    createManualReviewTask(data, user, "订单已被其他用户绑定", dateText, order.order_id);
    throw businessError(3002, "订单已被其他用户绑定，已进入人工确认");
  }

  order.user_id = user.user_id;
  order.matched_at = nowISO();
  order.match_source = "AUTO_PHONE";
  order.receiver_phone = order.receiver_phone || phone;
  orderFulfillment.ensureFulfillment(data, order);
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  const nextAction = deliveryStatus === "DELIVERED" ? "READY_TO_START" : "WAITING_DELIVERY";
  return response({
    success: true,
    order: orderFulfillment.toOrderPayload(data, order),
    identityWarnings: identity.warnings,
    nextAction,
    canStartCheckin: deliveryStatus === "DELIVERED",
    session: null,
    user: publicUser(user),
  });
}

function startCheckin(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  ensureCanActivate(user);
  if (!body.confirmReceived) throw businessError(4003, "请先确认已收到产品");
  const matchedOrders = data.youzanOrders.filter((order) => order.user_id === user.user_id);
  const orderId = body.orderId || body.order_id || "";
  const order = orderId
    ? matchedOrders.find((item) => item.order_id === orderId)
    : matchedOrders.find((item) => orderFulfillment.getOrderDeliveryStatus(data, item) === "DELIVERED") || matchedOrders[0];
  if (!order) {
    createManualReviewTask(data, user, "用户未匹配订单但尝试开始打卡", dateText);
    throw businessError(4004, "请先匹配收货手机号对应的订单，已进入人工确认");
  }
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  if (deliveryStatus !== "DELIVERED") {
    if (deliveryStatus === "EXCEPTION") createManualReviewTask(data, user, "物流异常，需要人工确认", dateText, order.order_id);
    throw businessError(4005, "物流送达后才能开始打卡");
  }
  const session = createCheckinSession(data, user, order.order_id, "order_delivered", dateText);
  return response({ success: true, session: toSessionPayload(data, session, dateText), user: publicUser(user) });
}

function getSession(data, token, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response({ session: toSessionPayload(data, session, dateText), user: publicUser(user) });
}

function submitCheckin(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentActiveSession(data, user.user_id);
  if (!session) throw businessError(4001, "无打卡中的周期");

  const currentDayIndex = Math.min(7, Math.max(1, daysBetween(session.start_date, dateText) + 1));
  const dayIndex = Number(body.dayIndex || currentDayIndex);
  if (dayIndex < 1 || dayIndex > 7) throw businessError(4003, "不在打卡时间窗");
  if (dayIndex > currentDayIndex) throw businessError(4003, "还未到这一天");
  if (currentDayIndex - dayIndex > 1) throw businessError(4003, "仅支持次日23:59前补卡");

  if (body.tookProduct === false) {
    return response({
      success: true,
      accepted: false,
      message: "今天先完成服用，再回来打卡。",
      session: toSessionPayload(data, session, dateText),
    });
  }

  const duplicated = data.checkinRecords.some((record) => record.session_id === session.session_id && record.day_index === dayIndex);
  if (duplicated) throw businessError(4002, "今日已打卡");

  const record = {
    record_id: createId("rec"),
    session_id: session.session_id,
    user_id: user.user_id,
    day_index: dayIndex,
    checkin_date: dateText,
    took_product: Boolean(body.tookProduct),
    had_stool: Boolean(body.hadStool),
    stool_type: body.hadStool ? body.stoolType || "" : "",
    feedback: body.feedback || "",
    image_urls: Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, 3) : [],
    checked_in_at: nowISO(),
    is_makeup: dayIndex < currentDayIndex,
  };
  data.checkinRecords.push(record);
  let nextAction = "";
  let couponStatus = null;

  if (dayIndex === 4 && !questionnaire.getResponse(data, user.user_id, session.session_id, "DAY4_MIDPOINT")) {
    nextAction = "DAY4_QUESTIONNAIRE";
    operationTask.createOperationTaskOnce(data, {
      task_type: "DAY4_QUESTIONNAIRE_PENDING",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day4 中期问卷待完成",
      suggested_action: "提醒用户完成中期问卷",
    });
  }

  if (dayIndex === 6) {
    const couponResult = coupon.triggerCoupon(data, user, session, "DAY6_CHECKIN", dateText);
    couponStatus = coupon.toCouponPayload(couponResult.coupon);
  }

  const complete = [1, 2, 3, 4, 5, 6, 7].every((day) => {
    return data.checkinRecords.some((item) => item.session_id === session.session_id && item.day_index === day);
  });
  if (complete) {
    session.status = "COMPLETED";
    user.state = STATES.CHECKIN_COMPLETED;
    user.completed_at = nowISO();
    user.total_checkin_days = Math.max(user.total_checkin_days || 0, 7);
    user.current_streak = Math.max(user.current_streak || 0, 7);
    user.longest_streak = Math.max(user.longest_streak || 0, user.current_streak || 7);
    user.last_checkin_date = record.checkin_date;
    nextAction = "DAY8_QUESTIONNAIRE";
    operationTask.createOperationTaskOnce(data, {
      task_type: "DAY8_QUESTIONNAIRE_PENDING",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day8 收尾问卷待完成",
      suggested_action: "提醒用户完成收尾问卷后进入人工退款",
    });
  }

  return response({ success: true, record, nextAction, coupon: couponStatus, session: toSessionPayload(data, session, dateText), user: publicUser(user) });
}

function transitionToDailyUser(data, user, reason = "continue") {
  if (!user) throw businessError(404, "用户不存在", 404);
  if (![STATES.CHECKIN_COMPLETED, STATES.DAILY_USER].includes(user.state)) {
    throw businessError(403, "当前状态不可转入日常打卡", 403);
  }
  user.state = STATES.DAILY_USER;
  user.daily_started_at = user.daily_started_at || nowISO();
  user.total_checkin_days = Math.max(user.total_checkin_days || 0, 7);
  user.current_streak = Math.max(user.current_streak || 0, 7);
  user.longest_streak = Math.max(user.longest_streak || 0, user.current_streak || 7);
  data.eventsTrack.push({
    event_id: createId("trk"),
    user_id: user.user_id,
    event_name: "daily_user_started",
    payload: { reason },
    created_at: nowISO(),
  });
  return user;
}

function continueAsDailyUser(data, token) {
  const user = requireUser(data, token);
  transitionToDailyUser(data, user, "user_click");
  return response({ success: true, user: publicUser(user) });
}

function getDailyRecord(data, userId, dateText) {
  return data.dailyCheckinRecords.find((record) => record.user_id === userId && record.checkin_date === dateText) || null;
}

function dailyStats(data, token, dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  return response({
    totalDays: user.total_checkin_days || 0,
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    todayChecked: Boolean(getDailyRecord(data, user.user_id, dateText)),
    lastCheckinDate: user.last_checkin_date || "",
  });
}

function updateDailyStreak(user, dateText) {
  const yesterday = addDays(dateText, -1);
  const previousStreak = user.last_checkin_date === yesterday ? user.current_streak || 0 : 0;
  user.current_streak = previousStreak + 1;
  user.longest_streak = Math.max(user.longest_streak || 0, user.current_streak);
  user.total_checkin_days = (user.total_checkin_days || 0) + 1;
  user.last_checkin_date = dateText;
}

function submitDailyCheckin(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  if (getDailyRecord(data, user.user_id, dateText)) throw businessError(4002, "今日已打卡");

  updateDailyStreak(user, dateText);
  const record = {
    record_id: createId("daily"),
    user_id: user.user_id,
    checkin_date: dateText,
    took_product: Boolean(body.tookProduct),
    had_stool: Boolean(body.hadStool),
    stool_type: body.hadStool ? body.stoolType || "" : "",
    feedback: body.feedback || "",
    checked_in_at: nowISO(),
    streak_count: user.current_streak,
    created_at: nowISO(),
  };
  data.dailyCheckinRecords.push(record);
  return response({ success: true, record, stats: dailyStats(data, token, dateText).data, user: publicUser(user) });
}

function dailyHistory(data, token, query = {}) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  const limit = Math.max(1, Math.min(100, Number(query.limit || 30)));
  const records = data.dailyCheckinRecords
    .filter((record) => record.user_id === user.user_id)
    .sort((left, right) => right.checkin_date.localeCompare(left.checkin_date))
    .slice(0, limit);
  return response({ records });
}

function dailyTrend(data, token, range = "7d", dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  const days = range === "30d" ? 30 : 7;
  const points = Array.from({ length: days }, (_, index) => {
    const day = addDays(dateText, index - days + 1);
    const record = getDailyRecord(data, user.user_id, day);
    return {
      date: day,
      checked: Boolean(record),
      stoolType: record ? record.stool_type : "",
    };
  });
  return response({ range, points });
}

function trackEvent(data, token, body = {}) {
  const user = requireUser(data, token);
  const event = {
    event_id: createId("trk"),
    user_id: user.user_id,
    event_name: body.eventName || "unknown_event",
    payload: body.payload || {},
    created_at: nowISO(),
  };
  data.eventsTrack.push(event);
  return response({ success: true, eventId: event.event_id });
}

function getRecordList(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response({ records: getRecords(data, session.session_id), session: toSessionPayload(data, session) });
}

function getRecordDetail(data, token, dayIndex) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  const record = data.checkinRecords.find((item) => item.session_id === session.session_id && item.day_index === Number(dayIndex));
  return response({ record: record || null });
}

function getQuestionnaire(data, token, type) {
  requireUser(data, token);
  return response({ questionnaire: questionnaire.getQuestionnaire(data, type) });
}

function getQuestionnaireStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response(questionnaire.getQuestionnaireStatus(data, user.user_id, session.session_id));
}

function submitQuestionnaire(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const result = questionnaire.submitQuestionnaire(data, user, session, body);
  if (result.response.needs_follow) {
    operationTask.createOperationTaskOnce(data, {
      task_type: "QUESTIONNAIRE_FOLLOW",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: `${result.response.questionnaire_type} 反馈需要跟进`,
      suggested_action: "通过企业微信联系用户确认反馈",
    });
  }
  const pendingTaskType = result.response.questionnaire_type === "DAY4_MIDPOINT"
    ? "DAY4_QUESTIONNAIRE_PENDING"
    : result.response.questionnaire_type === "DAY8_SUMMARY"
      ? "DAY8_QUESTIONNAIRE_PENDING"
      : "";
  if (pendingTaskType) {
    operationTask.listOpenOperationTasks(data, { userId: user.user_id, taskType: pendingTaskType }).forEach((task) => {
      operationTask.completeOperationTask(data, task.task_id, { result: "QUESTIONNAIRE_SUBMITTED" });
    });
  }
  let refund = null;
  if (result.response.questionnaire_type === "DAY8_SUMMARY") {
    try {
      refund = refundWorkItem.createRefundWorkItem(data, user.user_id, session.session_id).item;
    } catch (error) {
      operationTask.createOperationTaskOnce(data, {
        task_type: "MANUAL_REVIEW_REQUIRED",
        user_id: user.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: error.message,
        suggested_action: "确认退款资格异常原因",
      });
    }
  }
  return response({ success: true, response: result.response, created: result.created, refundWorkItem: refund });
}

function applyRefund(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session || user.state !== STATES.CHECKIN_COMPLETED) throw businessError(5001, "尚未完成有效7天打卡");
  const result = refundWorkItem.createRefundWorkItem(data, user.user_id, session.session_id);
  return response({ success: true, refundWorkItem: result.item, refund: result.item, created: result.created });
}

function getRefundStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = refundWorkItem.getRefundStatus(data, user.user_id, session ? session.session_id : "");
  return response({
    refundStatus: status.refundStatus || (session ? session.refund_status : null),
    refund: status.refundWorkItem,
    refundWorkItem: status.refundWorkItem,
    eligibility: status.eligibility,
  });
}

function getCouponStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  return response(coupon.getCouponStatus(data, user, session));
}

function claimCoupon(data, token, body = {}) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = coupon.getCouponStatus(data, user, session);
  const couponId = body.couponId || body.coupon_id || (status.coupon ? status.coupon.couponId : "");
  const claimed = coupon.claimCoupon(data, user.user_id, couponId);
  return response({ success: true, coupon: coupon.toCouponPayload(claimed) });
}

function recordCouponRepurchaseClick(data, token, body = {}, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = coupon.getCouponStatus(data, user, session);
  const couponId = body.couponId || body.coupon_id || (status.coupon ? status.coupon.couponId : "");
  const clicked = coupon.markRepurchaseClick(data, user.user_id, couponId);
  const task = operationTask.createOperationTaskOnce(data, {
    task_type: "REPURCHASE_INTENT",
    user_id: user.user_id,
    order_id: session ? session.order_id || "" : "",
    task_date: dateText,
    dedupe_key: clicked.coupon_id,
    reason: "用户点击复购入口",
    suggested_action: "企业微信轻触达，确认是否需要购买建议或使用优惠券",
    suggested_script: "看到你刚刚点了复购入口，如果需要我可以帮你确认优惠券和使用方式。",
    metadata: { couponId: clicked.coupon_id },
  }).task;
  return response({ success: true, coupon: coupon.toCouponPayload(clicked), task: toOperationTaskPayload(data, task) });
}

function uploadImage(data, token, body) {
  const user = requireUser(data, token);
  const item = {
    upload_id: createId("upl"),
    user_id: user.user_id,
    url: body.url || `/uploads/${createId("img")}.png`,
    created_at: nowISO(),
  };
  data.uploads.push(item);
  return response({ url: item.url });
}

function ensureDailySummaries(data) {
  if (!Array.isArray(data.dailySummaries)) data.dailySummaries = [];
  return data.dailySummaries;
}

function expectedDayIndex(session, dateText) {
  return daysBetween(session.start_date, dateText) + 1;
}

function hasCheckinRecord(data, session, dayIndex) {
  return data.checkinRecords.some((record) => {
    return record.session_id === session.session_id && record.day_index === dayIndex;
  });
}

function addAuditTask(data, task, createdTasks) {
  const result = operationTask.createOperationTaskOnce(data, task);
  if (result.created) createdTasks.push(result.task);
  return result.task;
}

function generateOperationTasks(data, dateText = todayISO()) {
  const createdTasks = [];
  const yesterday = addDays(dateText, -1);

  data.checkinSessions.filter((session) => session.status === "ACTIVE").forEach((session) => {
    const dayIndex = expectedDayIndex(session, yesterday);
    if (dayIndex < 1 || dayIndex > 7) return;
    if (hasCheckinRecord(data, session, dayIndex)) return;

    const auditedMissDays = Array.isArray(session.audited_miss_days) ? session.audited_miss_days : [];
    if (auditedMissDays.includes(yesterday)) return;
    session.audited_miss_days = auditedMissDays.concat(yesterday);
    session.miss_count += 1;

    addAuditTask(data, {
      task_type: "MISSED_CHECKIN",
      user_id: session.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: `Day${dayIndex} 未打卡`,
      suggested_action: "通过企业微信提醒用户补卡或确认是否继续参与",
      suggested_script: "今天还能补昨天的记录，如果已经服用过，可以现在进入小程序补一下。",
      metadata: { sessionId: session.session_id, missedDate: yesterday, dayIndex },
    }, createdTasks);

    if (session.miss_count >= 2) {
      addAuditTask(data, {
        task_type: "TWO_DAY_INACTIVE",
        user_id: session.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: `连续未打卡风险，累计断卡 ${session.miss_count} 次`,
        suggested_action: "人工确认用户是否还要继续试饮，并记录原因",
        suggested_script: "这两天还没看到你的记录，我来确认一下是否还在继续服用，方便我们帮你保留参与资格。",
        metadata: { sessionId: session.session_id, missCount: session.miss_count },
      }, createdTasks);
    }

    if (session.miss_count >= 3) {
      session.status = "FAILED";
      const user = data.users.find((item) => item.user_id === session.user_id);
      if (user) user.state = STATES.CHECKIN_FAILED;
    }
  });

  data.checkinSessions
    .filter((session) => ["ACTIVE", "COMPLETED"].includes(session.status))
    .forEach((session) => {
      if (!hasCheckinRecord(data, session, 4)) return;
      if (questionnaire.getResponse(data, session.user_id, session.session_id, "DAY4_MIDPOINT")) return;
      addAuditTask(data, {
        task_type: "DAY4_QUESTIONNAIRE_PENDING",
        user_id: session.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: "Day4 中期问卷待完成",
        suggested_action: "提醒用户补充中期反馈，便于后续观察效果",
        suggested_script: "第4天的小问卷还差一步，填完后我们能更准确地跟进你的体验。",
        metadata: { sessionId: session.session_id, questionnaireType: "DAY4_MIDPOINT" },
      }, createdTasks);
    });

  data.checkinSessions.filter((session) => session.status === "COMPLETED").forEach((session) => {
    if (questionnaire.getResponse(data, session.user_id, session.session_id, "DAY8_SUMMARY")) return;
    addAuditTask(data, {
      task_type: "DAY8_QUESTIONNAIRE_PENDING",
      user_id: session.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day8 收尾问卷待完成",
      suggested_action: "提醒用户完成收尾问卷后进入人工退款",
      suggested_script: "7天记录已经完成了，最后补一下收尾问卷，我们就可以进入免单审核。",
      metadata: { sessionId: session.session_id, questionnaireType: "DAY8_SUMMARY" },
    }, createdTasks);
  });

  data.refundWorkItems.filter((item) => item.status === "PENDING").forEach((item) => {
    addAuditTask(data, {
      task_type: "REFUND_PENDING",
      user_id: item.user_id,
      order_id: item.order_id || "",
      task_date: dateText,
      reason: "免单退款待人工处理",
      suggested_action: "核对订单、Day8 问卷和打卡记录后标记退款完成",
      suggested_script: "你的免单申请已经进入人工审核，我们核对完成后会同步处理结果。",
      metadata: { refundWorkItemId: item.refund_work_item_id, sessionId: item.session_id },
    }, createdTasks);
  });

  data.couponEvents.filter((item) => item.status === "CLAIMED").forEach((item) => {
    addAuditTask(data, {
      task_type: "COUPON_UNUSED",
      user_id: item.user_id,
      order_id: item.order_id || "",
      task_date: dateText,
      dedupe_key: item.coupon_id,
      reason: "优惠券已领取但未核销",
      suggested_action: "轻触达确认用户是否需要复购帮助",
      suggested_script: "你领取的复购礼还没有使用，如果需要我可以帮你确认使用方式。",
      metadata: { couponId: item.coupon_id, sessionId: item.session_id },
    }, createdTasks);
  });

  return { tasks: createdTasks, createdCount: createdTasks.length };
}

function buildDailySummary(data, dateText = todayISO(), generatedTasks = 0) {
  const activeSessions = data.checkinSessions.filter((session) => session.status === "ACTIVE");
  const completedSessions = data.checkinSessions.filter((session) => session.status === "COMPLETED");
  const dueSessions = activeSessions.filter((session) => {
    const dayIndex = expectedDayIndex(session, dateText);
    return dayIndex >= 1 && dayIndex <= 7;
  });
  const checkedToday = dueSessions.filter((session) => {
    return hasCheckinRecord(data, session, expectedDayIndex(session, dateText));
  }).length;
  const day4Pending = data.checkinSessions.filter((session) => {
    if (!["ACTIVE", "COMPLETED"].includes(session.status)) return false;
    if (!hasCheckinRecord(data, session, 4)) return false;
    return !questionnaire.getResponse(data, session.user_id, session.session_id, "DAY4_MIDPOINT");
  }).length;
  const day8Pending = completedSessions.filter((session) => {
    return !questionnaire.getResponse(data, session.user_id, session.session_id, "DAY8_SUMMARY");
  }).length;
  const refundPending = data.refundWorkItems.filter((item) => item.status === "PENDING").length;
  const couponUnused = data.couponEvents.filter((item) => item.status === "CLAIMED").length;
  return {
    date: dateText,
    activeSessions: activeSessions.length,
    completedSessions: completedSessions.length,
    failedSessions: data.checkinSessions.filter((session) => session.status === "FAILED").length,
    dueToday: dueSessions.length,
    checkedToday,
    missedToday: Math.max(0, dueSessions.length - checkedToday),
    day4Pending,
    day8Pending,
    refundPending,
    couponUnused,
    openTasks: operationTask.listOpenOperationTasks(data).length,
    generatedTasks,
    auditedAt: nowISO(),
  };
}

function upsertDailySummary(data, summary) {
  const summaries = ensureDailySummaries(data);
  const existing = summaries.find((item) => item.date === summary.date);
  if (existing) Object.assign(existing, summary);
  else summaries.push(summary);
  return summary;
}

function latestDailySummary(data, dateText = todayISO()) {
  const summaries = ensureDailySummaries(data);
  const exact = summaries.find((item) => item.date === dateText);
  if (exact) return exact;
  return summaries.slice().sort((left, right) => right.date.localeCompare(left.date))[0] || buildDailySummary(data, dateText, 0);
}

function runDailyAudit(data, dateText = todayISO()) {
  const generated = generateOperationTasks(data, dateText);
  const summary = upsertDailySummary(data, buildDailySummary(data, dateText, generated.createdCount));
  return response({ success: true, auditedAt: dateText, summary, tasks: generated.tasks });
}

function updateOrderFulfillment(data, body, dateText = todayISO()) {
  const result = orderFulfillment.updateOrderFulfillment(data, body, dateText);
  return response({
    success: true,
    order: orderFulfillment.toOrderPayload(data, result.order),
    fulfillment: result.fulfillment,
    task: result.task,
  });
}

function syncManualOrder(data, body) {
  const order = orderFulfillment.syncManualOrder(data, body);
  return response({ success: true, order: orderFulfillment.toOrderPayload(data, order) });
}

function searchAdminOrderMatching(data, query = {}) {
  return response(adminOrderMatching.searchOrderMatchingCandidates(data, query));
}

function previewAdminOrderMatch(data, body = {}) {
  return response(adminOrderMatching.previewOrderMatch(data, body));
}

function confirmAdminOrderMatch(data, body = {}, dateText = todayISO()) {
  return response(adminOrderMatching.confirmOrderMatch(data, body, dateText));
}

function sampleInputFromBody(body = {}) {
  return body.samples !== undefined ? body.samples : body.text;
}

function previewExternalSamples(data, body = {}) {
  const result = externalAdapterSamples.previewExternalSamples(data, body.sourceType, sampleInputFromBody(body) || []);
  const review = externalAdapterSamples.recordExternalSampleReview(data, "PREVIEW", result);
  return response({ ...result, review });
}

function importExternalSamples(data, body = {}, dateText = todayISO()) {
  const result = externalAdapterSamples.importExternalSamples(data, body.sourceType, sampleInputFromBody(body) || [], dateText);
  const review = externalAdapterSamples.recordExternalSampleReview(data, "IMPORT", result);
  return response({ ...result, review });
}

function upsertExternalStatusMapping(data, body = {}) {
  const mapping = externalAdapterSamples.upsertStatusMapping(data, body);
  return response({ success: true, mapping, mappings: externalAdapterSamples.listStatusMappings(data) });
}

function getExternalSampleTemplate(sourceType) {
  if (sourceType) return response(externalAdapterSamples.sampleTemplateFor(sourceType));
  return response({ templates: externalAdapterSamples.listSampleTemplates() });
}

function getExternalAdapters(data, context = {}) {
  return response({
    catalog: externalPlatformAdapters.buildAdapterCatalog(context.env || process.env, {
      data,
      adapterImplementations: context.adapterImplementations || {},
    }),
    runs: externalPlatformAdapters.listAdapterRuns(data),
    cursors: externalPlatformAdapters.listAdapterCursors(data),
    readiness: externalAdapterSamples.buildAdapterReadiness(data),
  });
}

function getAdapterCalibration(data, context = {}) {
  return response(adapterCalibration.buildAdapterCalibration(data, {
    env: context.env || process.env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  }));
}

function getReleaseRecord(data, context = {}) {
  return response(releaseRecord.buildReleaseRecord(data, {
    ...context,
    env: context.env || process.env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
    target: context.target || "production",
  }));
}

async function runExternalAdapter(data, body = {}, context = {}, dateText = todayISO()) {
  const result = await externalPlatformAdapters.runAdapter(data, body, {
    env: context.env || process.env,
    dateText,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  });
  return response({ success: true, ...result });
}

function getReadyToStartUsers(data, dateText = todayISO()) {
  return response({ users: orderFulfillment.getReadyToStartUsers(data, dateText) });
}

function listOperationTasks(data, query = {}) {
  const hasStatusFilter = Boolean(query.status || query.taskStatus || query.task_status);
  const effectiveQuery = hasStatusFilter ? query : { ...query, status: "OPEN" };
  return response({ tasks: operationTask.listOperationTasks(data, effectiveQuery).map((task) => toOperationTaskPayload(data, task)) });
}

function completeOperationTask(data, taskId, body = {}) {
  const task = operationTask.completeOperationTask(data, taskId, body);
  return response({ success: true, task: toOperationTaskPayload(data, task) });
}

function feedbackTextFromAnswers(answers = {}) {
  return answers.feedback || answers.note || answers.other || "";
}

function buildFeedbackItems(data, userId) {
  const checkinItems = data.checkinRecords
    .filter((record) => record.user_id === userId)
    .filter((record) => record.feedback || (Array.isArray(record.image_urls) && record.image_urls.length))
    .map((record) => ({
      feedbackId: record.record_id,
      sourceType: "CHECKIN_RECORD",
      sourceId: record.record_id,
      date: record.checkin_date,
      title: `Day${record.day_index} 打卡反馈`,
      text: record.feedback || "",
      imageUrls: Array.isArray(record.image_urls) ? record.image_urls : [],
      severity: ["type1", "type6", "type7"].includes(record.stool_type) ? "HIGH" : "NORMAL",
      metadata: { dayIndex: record.day_index, stoolType: record.stool_type || "", hadStool: record.had_stool },
    }));

  const questionnaireItems = data.questionnaireResponses
    .filter((item) => item.user_id === userId)
    .filter((item) => item.needs_follow || feedbackTextFromAnswers(item.answers))
    .map((item) => ({
      feedbackId: item.response_id,
      sourceType: "QUESTIONNAIRE_RESPONSE",
      sourceId: item.response_id,
      date: item.submitted_at,
      title: item.questionnaire_type,
      text: feedbackTextFromAnswers(item.answers),
      imageUrls: [],
      severity: item.needs_follow ? "HIGH" : "NORMAL",
      metadata: { questionnaireType: item.questionnaire_type, answers: item.answers || {} },
    }));

  const dailyItems = data.dailyCheckinRecords
    .filter((record) => record.user_id === userId && record.feedback)
    .map((record) => ({
      feedbackId: record.record_id,
      sourceType: "DAILY_CHECKIN_RECORD",
      sourceId: record.record_id,
      date: record.checkin_date,
      title: "日常打卡反馈",
      text: record.feedback || "",
      imageUrls: [],
      severity: ["type1", "type6", "type7"].includes(record.stool_type) ? "HIGH" : "NORMAL",
      metadata: { stoolType: record.stool_type || "", streakCount: record.streak_count || 0 },
    }));

  return checkinItems.concat(questionnaireItems, dailyItems).sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function buildRefundDetail(data, userId, session) {
  const items = data.refundWorkItems.filter((item) => item.user_id === userId);
  const compatibilityItems = data.refunds.filter((item) => item.user_id === userId);
  const eligibility = session
    ? refundWorkItem.evaluateRefundEligibility(data, userId, session.session_id)
    : { eligible: false, reason: "暂无打卡周期" };
  return {
    eligibility,
    workItems: items,
    compatibilityItems,
    latest: items[0] || compatibilityItems[0] || null,
  };
}

function getAdminUserDetail(data, userId) {
  const user = data.users.find((item) => item.user_id === userId);
  if (!user) throw businessError(404, "用户不存在", 404);
  const sessions = data.checkinSessions.filter((session) => session.user_id === userId);
  const latestSession = sessions.slice().sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0] || null;
  const orders = data.youzanOrders.filter((order) => order.user_id === userId).map((order) => orderFulfillment.toOrderPayload(data, order));
  const records = data.checkinRecords
    .filter((record) => record.user_id === userId)
    .sort((left, right) => left.day_index - right.day_index);
  const dailyRecords = data.dailyCheckinRecords
    .filter((record) => record.user_id === userId)
    .sort((left, right) => String(right.checkin_date).localeCompare(String(left.checkin_date)));
  const responses = data.questionnaireResponses
    .filter((item) => item.user_id === userId)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)));
  const tasks = operationTask.listOperationTasks(data, { userId }).map((task) => toOperationTaskPayload(data, task));

  return response({
    user: publicUser(user),
    leadProfiles: data.leadProfiles.filter((item) => item.user_id === userId),
    identityLinks: data.identityLinks.filter((item) => item.user_id === userId),
    profile: data.profiles.find((item) => item.user_id === userId) || null,
    opsSummary: adminUserPresenter.buildAdminUserDetailSummary(data, userId),
    orders,
    sessions: sessions.map((session) => toSessionPayload(data, session)),
    records,
    dailyRecords,
    questionnaireResponses: responses,
    feedbacks: buildFeedbackItems(data, userId),
    refund: buildRefundDetail(data, userId, latestSession),
    coupons: data.couponEvents.filter((item) => item.user_id === userId).map((item) => toCouponAdminPayload(data, item)),
    operationTasks: tasks,
  });
}

function createFeedbackFollowTask(data, userId, body = {}, dateText = todayISO()) {
  const user = data.users.find((item) => item.user_id === userId);
  if (!user) throw businessError(404, "用户不存在", 404);
  const session = currentSessionForUser(data, userId);
  const sourceType = body.sourceType || body.source_type || "";
  const sourceId = body.sourceId || body.source_id || "";
  const reason = body.reason || body.text || "用户反馈需要跟进";
  const result = operationTask.createOperationTaskOnce(data, {
    task_type: "FEEDBACK_FOLLOW",
    user_id: userId,
    order_id: session ? session.order_id || "" : "",
    task_date: dateText,
    dedupe_key: sourceType && sourceId ? `${sourceType}:${sourceId}` : "",
    reason,
    suggested_action: "通过企业微信联系用户，确认反馈背景并记录处理结果",
    suggested_script: "看到你的反馈了，我来确认一下具体情况，方便我们继续跟进体验。",
    metadata: { sourceType, sourceId },
  });
  return response({ success: true, task: toOperationTaskPayload(data, result.task), created: result.created });
}

function resolveManualReview(data, taskId, body = {}, dateText = todayISO()) {
  const tasks = operationTask.listOpenOperationTasks(data, { taskType: "MANUAL_REVIEW_REQUIRED" });
  const task = tasks.find((item) => item.task_id === taskId);
  if (!task) throw businessError(404, "人工确认待办不存在", 404);
  const user = data.users.find((item) => item.user_id === task.user_id);
  if (!user) throw businessError(404, "用户不存在", 404);

  let session = null;
  let result = body.result || "RESOLVED";
  if (body.action === "ALLOW_START") {
    const order = data.youzanOrders.find((item) => item.order_id === (body.orderId || task.order_id));
    if (order && order.user_id !== user.user_id) order.user_id = user.user_id;
    if (order && orderFulfillment.getOrderDeliveryStatus(data, order) !== "DELIVERED") {
      orderFulfillment.updateOrderFulfillment(data, { orderId: order.order_id, deliveryStatus: "DELIVERED" }, dateText);
    }
    session = createCheckinSession(data, user, order ? order.order_id : "", "manual_review", dateText);
    result = "ALLOWED_START";
  } else if (body.action === "COMPLETE_ORDER_AND_START") {
    const order = orderFulfillment.syncManualOrder(data, { ...(body.order || {}), userId: user.user_id, deliveryStatus: "DELIVERED" });
    order.user_id = user.user_id;
    order.matched_at = order.matched_at || nowISO();
    order.match_source = "MANUAL_REVIEW";
    session = createCheckinSession(data, user, order.order_id, "manual_review_order", dateText);
    result = "ORDER_COMPLETED_AND_STARTED";
  } else if (body.action === "REJECT") {
    result = "REJECTED";
  }

  const completed = operationTask.completeOperationTask(data, taskId, { result, note: body.note || "" });
  return response({ success: true, task: completed, session: session ? toSessionPayload(data, session, dateText) : null, user: publicUser(user) });
}

function toOperationTaskPayload(data, task) {
  const user = data.users.find((item) => item.user_id === task.user_id);
  const order = data.youzanOrders.find((item) => item.order_id === task.order_id);
  return {
    ...task,
    taskId: task.task_id,
    taskType: task.task_type,
    taskDate: task.task_date,
    suggestedAction: task.suggested_action || "",
    suggestedScript: task.suggested_script || "",
    user: user ? publicUser(user) : null,
    order: order ? orderFulfillment.toOrderPayload(data, order) : null,
  };
}

function toCouponAdminPayload(data, couponEvent) {
  const user = data.users.find((item) => item.user_id === couponEvent.user_id);
  return {
    ...coupon.toCouponPayload(couponEvent),
    user: user ? publicUser(user) : null,
    orderId: couponEvent.order_id || "",
    sessionId: couponEvent.session_id || "",
  };
}

function adminLaunchReadiness(data, context = {}) {
  return response(launchReadiness.buildLaunchReadiness(data, context));
}

function adminDashboard(data, context = {}) {
  const active = data.checkinSessions.filter((item) => item.status === "ACTIVE").length;
  const completed = data.checkinSessions.filter((item) => item.status === "COMPLETED").length;
  const pendingRefunds = data.refundWorkItems.filter((item) => item.status === "PENDING").length;
  const matchedOrders = data.youzanOrders.filter((item) => item.user_id).length;
  const summary = latestDailySummary(data);
  return response({
    metrics: {
      users: data.users.length,
      registered: data.users.filter((item) => item.state !== STATES.UNREGISTERED).length,
      active,
      completed,
      matchedOrders,
      pendingRefunds,
    },
    summary,
    opsDashboard: adminOpsPresenter.buildOpsDashboard(data, summary),
    users: data.users.map(publicUser),
    opsUsers: adminUserPresenter.buildAdminUserRows(data),
    orders: data.youzanOrders.map((order) => orderFulfillment.toOrderPayload(data, order)),
    sessions: data.checkinSessions.map((session) => toSessionPayload(data, session)),
    operationTasks: operationTask.listOpenOperationTasks(data).map((task) => toOperationTaskPayload(data, task)),
    readyToStartUsers: orderFulfillment.getReadyToStartUsers(data),
    refunds: data.refundWorkItems,
    couponSummary: coupon.buildCouponSummary(data),
    coupons: data.couponEvents.map((item) => toCouponAdminPayload(data, item)),
    externalSampleReviews: externalAdapterSamples.listExternalSampleReviews(data),
    externalStatusMappings: externalAdapterSamples.listStatusMappings(data),
    externalAdapterReadiness: externalAdapterSamples.buildAdapterReadiness(data),
    externalSampleTemplates: externalAdapterSamples.listSampleTemplates(),
    externalAdapterCatalog: externalPlatformAdapters.buildAdapterCatalog(context.env || process.env, {
      data,
      adapterImplementations: context.adapterImplementations || {},
    }),
    externalAdapterRuns: externalPlatformAdapters.listAdapterRuns(data),
    externalAdapterCursors: externalPlatformAdapters.listAdapterCursors(data),
    adapterCalibration: adapterCalibration.buildAdapterCalibration(data, {
      env: context.env || process.env,
      adapterImplementations: context.adapterImplementations || {},
      fetchImpl: context.fetchImpl,
    }),
    launchReadiness: launchReadiness.buildLaunchReadiness(data, { ...context, target: context.target || "production" }),
    releaseRecord: releaseRecord.buildReleaseRecord(data, { ...context, target: context.target || "production" }),
  });
}

function approveRefund(data, refundId) {
  const workItem = data.refundWorkItems.find((item) => item.refund_work_item_id === refundId);
  if (workItem) {
    const paid = refundWorkItem.markRefundPaid(data, refundId);
    const user = data.users.find((item) => item.user_id === paid.user_id);
    if (user) transitionToDailyUser(data, user, "refund_paid");
    return response({ success: true, refund: paid, refundWorkItem: paid });
  }
  const refund = data.refunds.find((item) => item.refund_id === refundId);
  if (!refund) throw businessError(404, "退款单不存在", 404);
  refund.status = "PAID";
  refund.paid_at = nowISO();
  const session = data.checkinSessions.find((item) => item.session_id === refund.session_id);
  if (session) {
    session.status = "REFUNDED";
    session.refund_status = "PAID";
    const user = data.users.find((item) => item.user_id === session.user_id);
    if (user) transitionToDailyUser(data, user, "refund_paid");
  }
  return response({ success: true, refund });
}

function markCouponUsed(data, couponId) {
  const used = coupon.markCouponUsed(data, couponId);
  operationTask.listOpenOperationTasks(data, { userId: used.user_id, taskType: "COUPON_UNUSED" }).forEach((task) => {
    const matchesCoupon = task.metadata && task.metadata.couponId === used.coupon_id;
    if (matchesCoupon) operationTask.completeOperationTask(data, task.task_id, { result: "COUPON_USED" });
  });
  return response({ success: true, coupon: toCouponAdminPayload(data, used) });
}

module.exports = {
  ROUTE_PERMISSIONS,
  ROUTES_BY_STATE,
  STATES,
  adminLaunchReadiness,
  adminDashboard,
  applyRefund,
  approveRefund,
  claimCoupon,
  completeOperationTask,
  continueAsDailyUser,
  createFeedbackFollowTask,
  createStore,
  dailyHistory,
  dailyStats,
  dailyTrend,
  getProfile,
  getAdminUserDetail,
  getAdapterCalibration,
  getCouponStatus,
  getReleaseRecord,
  getQuestionnaire,
  getQuestionnaireStatus,
  getReadyToStartUsers,
  getExternalSampleTemplate,
  getExternalAdapters,
  generateOperationTasks,
  getUserOrders,
  getRecordDetail,
  getRecordList,
  getRefundStatus,
  getSession,
  getUserState,
  login,
  loginWithWechat,
  listOperationTasks,
  markCouponUsed,
  matchOrder,
  searchAdminOrderMatching,
  publicUser,
  previewAdminOrderMatch,
  confirmAdminOrderMatch,
  previewExternalSamples,
  importExternalSamples,
  upsertExternalStatusMapping,
  resolveManualReview,
  response,
  runDailyAudit,
  startCheckin,
  syncManualOrder,
  submitCheckin,
  submitDailyCheckin,
  submitProfile,
  submitQuestionnaire,
  recordCouponRepurchaseClick,
  runExternalAdapter,
  trackEvent,
  toSessionPayload,
  updateOrderFulfillment,
  uploadImage,
};
