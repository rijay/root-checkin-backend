const { nowISO, todayISO } = require("./dates");
const { normalizePhone } = require("./identity");
const operationTask = require("./operationTask");
const orderFulfillment = require("./orderFulfillment");

function matchingError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function publicUser(data, user) {
  if (!user) return null;
  const orders = (data.youzanOrders || []).filter((order) => order.user_id === user.user_id);
  const currentSession = (data.checkinSessions || []).find((session) => {
    return session.user_id === user.user_id && ["ACTIVE", "COMPLETED", "FAILED", "REFUNDED"].includes(session.status);
  });
  return {
    userId: user.user_id,
    nickname: user.nickname || "ROOT用户",
    phone: maskPhone(user.phone),
    state: user.state || "",
    matchedOrderCount: orders.length,
    currentSession: currentSession ? {
      sessionId: currentSession.session_id,
      orderId: currentSession.order_id || "",
      status: currentSession.status,
      startDate: currentSession.start_date,
    } : null,
  };
}

function publicOrder(data, order) {
  if (!order) return null;
  const payload = orderFulfillment.toOrderPayload(data, order);
  const boundUser = (data.users || []).find((user) => user.user_id === order.user_id) || null;
  return {
    ...payload,
    userId: order.user_id || "",
    boundUser: publicUser(data, boundUser),
    matchSource: order.match_source || "",
    paidAt: order.paid_at || "",
    rawAddressText: order.raw_address_text || "",
  };
}

function matchText(value, query, phoneQuery) {
  const text = String(value || "").toLowerCase();
  if (!query) return true;
  if (text.includes(query)) return true;
  return Boolean(phoneQuery && normalizePhone(text).includes(phoneQuery));
}

function orderMatches(order, query, phoneQuery) {
  if (!query) return !order.user_id;
  return [
    order.order_id,
    order.youzan_order_no,
    order.receiver_name,
    order.receiver_phone,
    order.phone,
    order.product_name,
  ].some((value) => matchText(value, query, phoneQuery));
}

function userMatches(user, query, phoneQuery) {
  if (!query) return true;
  return [
    user.user_id,
    user.nickname,
    user.phone,
    user.state,
  ].some((value) => matchText(value, query, phoneQuery));
}

function searchOrderMatchingCandidates(data, query = {}) {
  const text = String(query.q || query.query || "").trim();
  const normalizedQuery = text.toLowerCase();
  const phoneQuery = normalizePhone(text);
  const type = query.type || "all";
  const limit = Math.max(1, Math.min(Number(query.limit || 20), 50));
  const shouldSearchOrders = type === "all" || type === "orders" || type === "order";
  const shouldSearchUsers = type === "all" || type === "users" || type === "user";
  const orders = shouldSearchOrders
    ? (data.youzanOrders || [])
        .filter((order) => orderMatches(order, normalizedQuery, phoneQuery))
        .sort((left, right) => Number(Boolean(left.user_id)) - Number(Boolean(right.user_id)) || String(right.paid_at || "").localeCompare(String(left.paid_at || "")))
        .slice(0, limit)
        .map((order) => publicOrder(data, order))
    : [];
  const users = shouldSearchUsers
    ? (data.users || [])
        .filter((user) => userMatches(user, normalizedQuery, phoneQuery))
        .slice(0, limit)
        .map((user) => publicUser(data, user))
    : [];
  return {
    query: text,
    type,
    orders,
    users,
    pendingOrders: (data.youzanOrders || []).filter((order) => !order.user_id).slice(0, limit).map((order) => publicOrder(data, order)),
  };
}

function findOrder(data, body = {}) {
  const orderId = body.orderId || body.order_id;
  const orderNo = body.youzanOrderNo || body.youzan_order_no;
  if (orderId) return (data.youzanOrders || []).find((order) => order.order_id === orderId) || null;
  if (orderNo) return (data.youzanOrders || []).find((order) => order.youzan_order_no === orderNo) || null;
  return null;
}

function findUser(data, body = {}) {
  const userId = body.userId || body.user_id;
  const phone = normalizePhone(body.userPhone || body.user_phone || body.phone);
  if (userId) return (data.users || []).find((user) => user.user_id === userId) || null;
  if (phone) return (data.users || []).find((user) => user.phone === phone) || null;
  return null;
}

function risk(type, level, message, options = {}) {
  return {
    type,
    level,
    message,
    blocking: Boolean(options.blocking),
    requiresSecondConfirm: Boolean(options.requiresSecondConfirm),
  };
}

function buildRisks(data, order, user) {
  const risks = [];
  const orderPhone = normalizePhone(order.receiver_phone || order.phone);
  const userPhone = normalizePhone(user.phone);
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  const boundUser = order.user_id ? (data.users || []).find((item) => item.user_id === order.user_id) : null;
  const otherUserOrders = (data.youzanOrders || []).filter((item) => item.user_id === user.user_id && item.order_id !== order.order_id);
  const activeSession = (data.checkinSessions || []).find((session) => {
    return session.user_id === user.user_id && ["ACTIVE", "COMPLETED", "FAILED", "REFUNDED"].includes(session.status) && session.order_id !== order.order_id;
  });

  if (order.user_id && order.user_id !== user.user_id) {
    risks.push(risk(
      "ORDER_BOUND_TO_OTHER_USER",
      "HIGH",
      `订单已绑定给 ${boundUser ? `${boundUser.nickname || "ROOT用户"}（${maskPhone(boundUser.phone)}）` : order.user_id}`,
      { blocking: true, requiresSecondConfirm: true }
    ));
  }
  if (orderPhone && userPhone && orderPhone !== userPhone) {
    risks.push(risk("PHONE_MISMATCH", "MEDIUM", `收货手机号 ${maskPhone(orderPhone)} 与用户手机号 ${maskPhone(userPhone)} 不一致`, { requiresSecondConfirm: true }));
  }
  if (otherUserOrders.length || activeSession) {
    risks.push(risk("USER_HAS_ACTIVE_ORDER", "MEDIUM", "该用户已有其他匹配订单或历史周期，请确认是否为同一人", { requiresSecondConfirm: true }));
  }
  if (deliveryStatus === "EXCEPTION") {
    risks.push(risk("FULFILLMENT_EXCEPTION", "HIGH", "订单物流异常，确认匹配后会进入物流异常待办", { requiresSecondConfirm: true }));
  } else if (deliveryStatus !== "DELIVERED") {
    risks.push(risk("ORDER_NOT_DELIVERED", "LOW", "订单尚未签收，确认匹配后用户仍需等待物流送达"));
  }
  return risks;
}

function buildWriteEffects(data, order) {
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  const effects = ["绑定有赞订单到小程序用户", "写入 matched_at 与 ADMIN_MANUAL_MATCH"];
  if (deliveryStatus === "DELIVERED") effects.push("生成已送达待开始提醒");
  if (deliveryStatus === "EXCEPTION") effects.push("生成物流异常待办");
  return effects;
}

function recommendedAction(risks, order, data) {
  if (risks.some((item) => item.type === "ORDER_BOUND_TO_OTHER_USER")) return "订单已绑定其他用户，需要填写备注后确认改绑";
  if (risks.some((item) => item.type === "PHONE_MISMATCH")) return "请核对手机号来源，确认无误后再匹配";
  if (orderFulfillment.getOrderDeliveryStatus(data, order) === "DELIVERED") return "确认后用户进入已送达待开始";
  return "确认后订单完成绑定，等待物流状态推进";
}

function previewOrderMatch(data, body = {}) {
  const order = findOrder(data, body);
  const user = findUser(data, body);
  if (!order) throw matchingError(3201, "订单不存在");
  if (!user) throw matchingError(3202, "用户不存在");
  const risks = buildRisks(data, order, user);
  const requiresSecondConfirm = risks.some((item) => item.requiresSecondConfirm);
  const canConfirm = !risks.some((item) => item.blocking);
  return {
    order: publicOrder(data, order),
    user: publicUser(data, user),
    risks,
    recommendedAction: recommendedAction(risks, order, data),
    writeEffects: buildWriteEffects(data, order),
    canConfirm,
    requiresSecondConfirm,
  };
}

function completeRelatedManualTasks(data, userId, orderId, note) {
  return operationTask
    .listOpenOperationTasks(data, { taskType: "MANUAL_REVIEW_REQUIRED" })
    .filter((task) => task.user_id === userId || (orderId && task.order_id === orderId))
    .map((task) => operationTask.completeOperationTask(data, task.task_id, {
      status: "DONE",
      result: "ORDER_MATCHED",
      note,
    }));
}

function confirmOrderMatch(data, body = {}, dateText = todayISO()) {
  const order = findOrder(data, body);
  const user = findUser(data, body);
  if (!order) throw matchingError(3201, "订单不存在");
  if (!user) throw matchingError(3202, "用户不存在");
  const preview = previewOrderMatch(data, body);
  const hasRebindRisk = preview.risks.some((item) => item.type === "ORDER_BOUND_TO_OTHER_USER");
  const hasRiskConfirm = Boolean(body.confirmRisks || body.confirm_risks);
  const hasRebindConfirm = Boolean(body.confirmRebind || body.confirm_rebind);
  const note = String(body.note || "").trim();

  if (preview.requiresSecondConfirm && !hasRiskConfirm && !hasRebindConfirm) {
    throw matchingError(3203, "请先确认风险提示");
  }
  if (hasRebindRisk && (!hasRebindConfirm || !note)) {
    throw matchingError(3204, "确认改绑必须勾选改绑确认并填写备注");
  }

  order.user_id = user.user_id;
  order.matched_at = nowISO();
  order.match_source = "ADMIN_MANUAL_MATCH";
  orderFulfillment.ensureFulfillment(data, order);
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  let task = null;
  if (deliveryStatus === "DELIVERED" || deliveryStatus === "EXCEPTION") {
    task = orderFulfillment.updateOrderFulfillment(data, { orderId: order.order_id, deliveryStatus }, dateText).task;
  }
  const completedManualTasks = completeRelatedManualTasks(data, user.user_id, order.order_id, note || "后台手动匹配订单");
  return {
    success: true,
    order: publicOrder(data, order),
    user: publicUser(data, user),
    risks: preview.risks,
    writeEffects: preview.writeEffects,
    task,
    completedManualTasks,
  };
}

module.exports = {
  confirmOrderMatch,
  previewOrderMatch,
  searchOrderMatchingCandidates,
};
