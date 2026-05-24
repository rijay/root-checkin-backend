const { listOpenOperationTasks } = require("./operationTask");
const { getOrderDeliveryStatus, toOrderPayload } = require("./orderFulfillment");
const { getQuestionnaireStatus } = require("./questionnaire");

function currentSessionForUser(data, userId) {
  return data.checkinSessions.find((session) => {
    return session.user_id === userId && ["ACTIVE", "COMPLETED", "FAILED", "REFUNDED"].includes(session.status);
  }) || null;
}

function matchedOrdersForUser(data, userId) {
  return data.youzanOrders.filter((order) => order.user_id === userId);
}

function hasOpenManualTask(data, userId) {
  return listOpenOperationTasks(data, { userId, taskType: "MANUAL_REVIEW_REQUIRED" }).length > 0;
}

function getFlowView(data, userId, dateText) {
  const user = data.users.find((item) => item.user_id === userId) || null;
  if (!user) return "GUEST";
  if (hasOpenManualTask(data, userId)) return "MANUAL_REVIEW_REQUIRED";
  if (user.state === "UNREGISTERED") return "REGISTER_PROFILE";
  const session = currentSessionForUser(data, userId);
  if (user.state === "CHECKIN_ACTIVE") {
    const status = session ? getQuestionnaireStatus(data, userId, session.session_id) : {};
    const hasDay4Task = listOpenOperationTasks(data, { userId, taskType: "DAY4_QUESTIONNAIRE_PENDING" }).length > 0;
    if (hasDay4Task && !status.DAY4_MIDPOINT) return "DAY4_PENDING";
    return "CHECKIN_ACTIVE";
  }
  if (user.state === "CHECKIN_COMPLETED") {
    const status = session ? getQuestionnaireStatus(data, userId, session.session_id) : {};
    if (!status.DAY8_SUMMARY) return "DAY8_PENDING";
    return "REFUND_PENDING";
  }
  if (user.state === "DAILY_USER") return "DAILY";
  if (user.state === "CHECKIN_FAILED") return "MANUAL_REVIEW_REQUIRED";

  if (session && session.status === "ACTIVE") return "CHECKIN_ACTIVE";

  const orders = matchedOrdersForUser(data, userId);
  if (!orders.length) return "ORDER_PENDING";
  if (orders.some((order) => getOrderDeliveryStatus(data, order) === "DELIVERED")) return "READY_TO_START";
  if (orders.some((order) => getOrderDeliveryStatus(data, order) === "EXCEPTION")) return "MANUAL_REVIEW_REQUIRED";
  return "WAITING_DELIVERY";
}

function getAllowedActions(flowView) {
  const actions = {
    GUEST: ["LOGIN"],
    REGISTER_PROFILE: ["SUBMIT_PROFILE"],
    ORDER_PENDING: ["MATCH_ORDER", "REQUEST_MANUAL_REVIEW"],
    WAITING_DELIVERY: ["VIEW_ORDER", "REQUEST_MANUAL_REVIEW"],
    READY_TO_START: ["START_CHECKIN"],
    MANUAL_REVIEW_REQUIRED: ["VIEW_MANUAL_REVIEW"],
    CHECKIN_ACTIVE: ["OPEN_CHECKIN", "VIEW_HISTORY"],
    DAY4_PENDING: ["OPEN_DAY4_QUESTIONNAIRE", "OPEN_CHECKIN"],
    DAY8_PENDING: ["OPEN_DAY8_QUESTIONNAIRE"],
    REFUND_PENDING: ["VIEW_REFUND", "CONTINUE_DAILY"],
    REFUNDED: ["CONTINUE_DAILY"],
    DAILY: ["OPEN_DAILY_CHECKIN", "VIEW_HISTORY"],
  };
  return actions[flowView] || [];
}

function getHomeViewModel(data, userId, dateText) {
  const flowView = getFlowView(data, userId, dateText);
  const allowedActions = getAllowedActions(flowView);
  const orders = matchedOrdersForUser(data, userId).map((order) => toOrderPayload(data, order));
  const openTasks = listOpenOperationTasks(data, { userId });
  const copy = {
    GUEST: ["欢迎回来", "请先登录后继续。"],
    REGISTER_PROFILE: ["完善入组画像", "完成 4 个问题后进入订单确认。"],
    ORDER_PENDING: ["确认收货手机号", "用收货手机号匹配有赞订单，匹配后等待物流送达。"],
    WAITING_DELIVERY: ["等待物流送达", "订单已匹配，送达后即可开始 Day1。"],
    READY_TO_START: ["可以开始 Day1", "订单已送达，确认后开启 7 天打卡。"],
    MANUAL_REVIEW_REQUIRED: ["等待人工确认", "信息已进入运营待办，请通过企业微信保持联系。"],
    CHECKIN_ACTIVE: ["今日身体记录", "继续完成 7 天试饮打卡。"],
    DAY4_PENDING: ["中期问卷待完成", "问卷不会阻塞打卡，但能帮助运营及时跟进反馈。"],
    DAY8_PENDING: ["收尾问卷待完成", "完成收尾问卷后才会进入人工退款处理。"],
    REFUND_PENDING: ["等待人工退款", "完成记录后可查看人工退款处理状态。"],
    DAILY: ["日常记录", "继续记录身体反馈。"],
  }[flowView] || ["当前状态", flowView];

  return {
    flowView,
    allowedActions,
    title: copy[0],
    description: copy[1],
    orders,
    openTasks,
  };
}

module.exports = {
  getAllowedActions,
  getFlowView,
  getHomeViewModel,
};
