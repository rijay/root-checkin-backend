const auditLog = require("./auditLog");
const { nowISO, todayISO } = require("./dates");
const { normalizePhone } = require("./identity");
const operationTask = require("./operationTask");
const orderFulfillment = require("./orderFulfillment");

const ACTIONS = new Set(["UPDATE_FULFILLMENT_STATUS", "BIND_ORDER_USER", "UNBIND_ORDER_USER", "IGNORE_CONFLICT"]);

function correctionError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAction(value) {
  const action = String(value || "").trim().toUpperCase();
  if (!ACTIONS.has(action)) throw correctionError(4201, "未知修正动作");
  return action;
}

function findOrder(data, input = {}) {
  const orderId = input.orderId || input.order_id;
  const orderNo = input.youzanOrderNo || input.youzan_order_no;
  if (orderId) return (data.youzanOrders || []).find((order) => order.order_id === orderId) || null;
  if (orderNo) return (data.youzanOrders || []).find((order) => order.youzan_order_no === orderNo) || null;
  return null;
}

function findUser(data, input = {}) {
  const userId = input.userId || input.user_id;
  const phone = normalizePhone(input.userPhone || input.user_phone || input.phone);
  if (userId) return (data.users || []).find((user) => user.user_id === userId) || null;
  if (phone) return (data.users || []).find((user) => normalizePhone(user.phone) === phone) || null;
  return null;
}

function findTask(data, input = {}) {
  const taskId = input.taskId || input.task_id;
  if (!taskId) return null;
  return (data.operationTasks || []).find((task) => task.task_id === taskId) || null;
}

function risk(type, level, message, options = {}) {
  return {
    type,
    level,
    message,
    requiresReason: Boolean(options.requiresReason),
    requiresSecondConfirm: Boolean(options.requiresSecondConfirm),
  };
}

function buildPreview(data, input = {}) {
  const action = normalizeAction(input.action);
  const order = findOrder(data, input);
  const user = findUser(data, input);
  const task = findTask(data, input);
  const risks = [];
  const effects = [];
  let targetType = "";
  let targetId = "";
  let before = null;
  let after = null;

  if (action === "UPDATE_FULFILLMENT_STATUS") {
    if (!order) throw correctionError(4202, "订单不存在");
    const nextStatus = String(input.deliveryStatus || input.delivery_status || "").trim().toUpperCase();
    if (!nextStatus) throw correctionError(4203, "物流状态必填");
    const fulfillment = orderFulfillment.getOrderFulfillment(data, order.order_id) || orderFulfillment.ensureFulfillment(data, order);
    targetType = "FULFILLMENT";
    targetId = fulfillment.fulfillment_id;
    before = { order: clone(order), fulfillment: clone(fulfillment) };
    after = { deliveryStatus: nextStatus };
    effects.push(`物流状态改为 ${nextStatus}`);
    if (nextStatus === "DELIVERED") effects.push("如订单已绑定用户，将生成已送达待开始待办");
    if (nextStatus === "CANCELLED") {
      risks.push(risk("FULFILLMENT_CANCELLED", "HIGH", "取消物流会阻断用户开始打卡", { requiresReason: true, requiresSecondConfirm: true }));
    }
  }

  if (action === "BIND_ORDER_USER") {
    if (!order) throw correctionError(4202, "订单不存在");
    if (!user) throw correctionError(4204, "用户不存在");
    targetType = "ORDER";
    targetId = order.order_id;
    before = { order: clone(order) };
    after = { userId: user.user_id };
    effects.push("手动绑定订单与用户");
    if (order.user_id && order.user_id !== user.user_id) {
      risks.push(risk("ORDER_REBIND", "HIGH", "订单已绑定其他用户，本次会改绑", { requiresReason: true, requiresSecondConfirm: true }));
    }
    const orderPhone = normalizePhone(order.receiver_phone || order.phone);
    const userPhone = normalizePhone(user.phone);
    if (orderPhone && userPhone && orderPhone !== userPhone) {
      risks.push(risk("PHONE_MISMATCH", "MEDIUM", "订单收货手机号与用户授权手机号不一致", { requiresReason: true, requiresSecondConfirm: true }));
    }
  }

  if (action === "UNBIND_ORDER_USER") {
    if (!order) throw correctionError(4202, "订单不存在");
    targetType = "ORDER";
    targetId = order.order_id;
    before = { order: clone(order) };
    after = { userId: "" };
    effects.push("解除订单与用户绑定");
    risks.push(risk("ORDER_UNBIND", "HIGH", "解绑可能影响用户打卡资格和退款链路", { requiresReason: true, requiresSecondConfirm: true }));
  }

  if (action === "IGNORE_CONFLICT") {
    if (!task) throw correctionError(4205, "冲突待办不存在");
    targetType = "TASK";
    targetId = task.task_id;
    before = { task: clone(task) };
    after = { status: "SKIPPED" };
    effects.push("标记冲突待办为已忽略");
    risks.push(risk("CONFLICT_IGNORED", "MEDIUM", "忽略冲突后系统不会继续提醒该批次冲突", { requiresReason: true }));
  }

  return {
    action,
    targetType,
    targetId,
    order: order ? orderFulfillment.toOrderPayload(data, order) : null,
    user: user ? { userId: user.user_id, phone: user.phone, nickname: user.nickname || "ROOT体验官", state: user.state } : null,
    task,
    risks,
    effects,
    before,
    after,
    requiresReason: risks.some((item) => item.requiresReason),
    requiresSecondConfirm: risks.some((item) => item.requiresSecondConfirm),
  };
}

function assertCanApply(preview, input = {}) {
  const reason = String(input.reason || input.note || "").trim();
  if (preview.requiresReason && !reason) throw correctionError(4206, "高风险修正必须填写原因");
  if (preview.requiresSecondConfirm && !Boolean(input.confirmRisk || input.confirm_risk || input.confirmRisks || input.confirm_risks)) {
    throw correctionError(4207, "请先二次确认修正风险");
  }
  return reason;
}

function applyCorrection(data, input = {}, context = {}, dateText = todayISO()) {
  const preview = buildPreview(data, input);
  const reason = assertCanApply(preview, input);
  let result = null;

  if (preview.action === "UPDATE_FULFILLMENT_STATUS") {
    const order = findOrder(data, input);
    result = orderFulfillment.updateOrderFulfillment(data, {
      orderId: order.order_id,
      deliveryStatus: String(input.deliveryStatus || input.delivery_status || "").trim().toUpperCase(),
      carrier: input.carrier,
      trackingNo: input.trackingNo || input.tracking_no,
      deliveredAt: input.deliveredAt || input.delivered_at,
      lastEventText: input.lastEventText || input.last_event_text || "后台手动修正",
    }, dateText);
  }

  if (preview.action === "BIND_ORDER_USER") {
    const order = findOrder(data, input);
    const user = findUser(data, input);
    order.user_id = user.user_id;
    order.matched_at = nowISO();
    order.match_source = "MANUAL_CORRECTION";
    orderFulfillment.ensureFulfillment(data, order);
    const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
    const task = ["DELIVERED", "EXCEPTION"].includes(deliveryStatus)
      ? orderFulfillment.updateOrderFulfillment(data, { orderId: order.order_id, deliveryStatus }, dateText).task
      : null;
    result = { order, user, task };
  }

  if (preview.action === "UNBIND_ORDER_USER") {
    const order = findOrder(data, input);
    const previousUserId = order.user_id || "";
    order.user_id = "";
    order.matched_at = "";
    order.match_source = "MANUAL_UNBOUND";
    result = { order, previousUserId };
  }

  if (preview.action === "IGNORE_CONFLICT") {
    const task = findTask(data, input);
    result = { task: operationTask.completeOperationTask(data, task.task_id, { status: "SKIPPED", result: "IGNORED_CONFLICT", note: reason }) };
  }

  const audit = auditLog.appendAuditLog(data, {
    action: preview.action,
    targetType: preview.targetType,
    targetId: preview.targetId,
    operatorId: context.operatorId || input.operatorId || input.operator_id || "",
    reason,
    before: preview.before,
    after: preview.after,
    metadata: { risks: preview.risks, effects: preview.effects },
  });
  return { success: true, preview, result, audit };
}

module.exports = {
  applyCorrection,
  previewCorrection: buildPreview,
};
