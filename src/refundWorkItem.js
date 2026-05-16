const { nowISO } = require("./dates");
const { createId } = require("./seed");
const { getResponse } = require("./questionnaire");
const { getOrderDeliveryStatus } = require("./orderFulfillment");

function ensureList(data) {
  if (!Array.isArray(data.refundWorkItems)) data.refundWorkItems = [];
  return data.refundWorkItems;
}

function findRefundWorkItem(data, sessionId) {
  return ensureList(data).find((item) => item.session_id === sessionId) || null;
}

function evaluateRefundEligibility(data, userId, sessionId) {
  const session = data.checkinSessions.find((item) => item.session_id === sessionId && item.user_id === userId);
  if (!session || session.status !== "COMPLETED") return { eligible: false, reason: "尚未完成有效7天打卡" };
  if (!session.order_id) return { eligible: false, reason: "未匹配订单，无法进入人工退款" };
  const order = data.youzanOrders.find((item) => item.order_id === session.order_id);
  if (!order) return { eligible: false, reason: "订单不存在，需人工确认" };
  if (getOrderDeliveryStatus(data, order) !== "DELIVERED") return { eligible: false, reason: "物流未送达，无法进入人工退款" };
  if (session.miss_count >= 3) return { eligible: false, reason: "断卡次数过多，无法进入人工退款" };
  if (!getResponse(data, userId, sessionId, "DAY8_SUMMARY")) return { eligible: false, reason: "请先完成 Day8 收尾问卷" };
  return { eligible: true, reason: "" };
}

function createRefundWorkItem(data, userId, sessionId) {
  const existing = findRefundWorkItem(data, sessionId);
  if (existing) return { item: existing, created: false };
  const eligibility = evaluateRefundEligibility(data, userId, sessionId);
  if (!eligibility.eligible) {
    const error = new Error(eligibility.reason);
    error.code = 5001;
    throw error;
  }
  const session = data.checkinSessions.find((item) => item.session_id === sessionId);
  const order = data.youzanOrders.find((item) => item.order_id === session.order_id);
  const item = {
    refund_work_item_id: createId("rwi"),
    session_id: session.session_id,
    user_id: userId,
    order_id: session.order_id,
    youzan_order_no: order ? order.youzan_order_no : "",
    amount: order ? order.amount : 0,
    status: "PENDING",
    created_at: nowISO(),
    paid_at: "",
    note: "",
  };
  ensureList(data).push(item);
  session.refund_status = "PENDING";
  return { item, created: true };
}

function markRefundPaid(data, refundWorkItemId) {
  const item = ensureList(data).find((candidate) => candidate.refund_work_item_id === refundWorkItemId);
  if (!item) {
    const error = new Error("退款工作项不存在");
    error.code = 404;
    error.status = 404;
    throw error;
  }
  item.status = "PAID";
  item.paid_at = nowISO();
  const session = data.checkinSessions.find((candidate) => candidate.session_id === item.session_id);
  if (session) {
    session.status = "REFUNDED";
    session.refund_status = "PAID";
  }
  return item;
}

function getRefundStatus(data, userId, sessionId) {
  const item = sessionId ? findRefundWorkItem(data, sessionId) : null;
  const eligibility = sessionId ? evaluateRefundEligibility(data, userId, sessionId) : { eligible: false, reason: "暂无打卡周期" };
  return {
    refundStatus: item ? item.status : null,
    refundWorkItem: item,
    eligibility,
  };
}

module.exports = {
  createRefundWorkItem,
  evaluateRefundEligibility,
  findRefundWorkItem,
  getRefundStatus,
  markRefundPaid,
};
