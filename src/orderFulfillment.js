const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");
const { createOperationTaskOnce } = require("./operationTask");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
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

function findOrder(data, body = {}) {
  const orderId = body.orderId || body.order_id;
  const orderNo = body.youzanOrderNo || body.youzan_order_no;
  if (orderId) return data.youzanOrders.find((item) => item.order_id === orderId) || null;
  if (orderNo) return data.youzanOrders.find((item) => item.youzan_order_no === orderNo) || null;
  return null;
}

function syncManualOrder(data, body = {}) {
  const receiverPhone = normalizePhone(body.receiverPhone || body.receiver_phone || body.phone);
  const orderNo = body.youzanOrderNo || body.youzan_order_no;
  if (!orderNo) {
    const error = new Error("订单号必填");
    error.code = 3003;
    throw error;
  }
  let order = data.youzanOrders.find((item) => item.youzan_order_no === orderNo);
  if (!order) {
    order = {
      order_id: body.orderId || body.order_id || createId("ord"),
      user_id: body.userId || body.user_id || "",
      youzan_order_no: orderNo,
      phone: receiverPhone,
      receiver_name: body.receiverName || body.receiver_name || "",
      receiver_phone: receiverPhone,
      product_name: body.productName || body.product_name || "ROOT 7日试饮装",
      product_id: body.productId || body.product_id || "ROOT-PREBIOTIC-TRIAL",
      amount: Number(body.amount || 0),
      paid_at: body.paidAt || body.paid_at || "",
      order_status: body.orderStatus || body.order_status || "PAID",
      delivery_status: body.deliveryStatus || body.delivery_status || "NOT_SHIPPED",
      raw_address_text: body.rawAddressText || body.raw_address_text || "",
      matched_at: "",
      match_source: "MANUAL",
    };
    data.youzanOrders.push(order);
  } else {
    order.user_id = body.userId || body.user_id || order.user_id || "";
    order.phone = receiverPhone || order.phone;
    order.receiver_phone = receiverPhone || order.receiver_phone || order.phone;
    order.receiver_name = body.receiverName || body.receiver_name || order.receiver_name || "";
    order.product_name = body.productName || body.product_name || order.product_name || "";
    order.amount = body.amount === undefined ? order.amount : Number(body.amount);
    order.order_status = body.orderStatus || body.order_status || order.order_status || "PAID";
    order.delivery_status = body.deliveryStatus || body.delivery_status || order.delivery_status || "NOT_SHIPPED";
    order.raw_address_text = body.rawAddressText || body.raw_address_text || order.raw_address_text || "";
  }
  ensureFulfillment(data, order);
  return order;
}

function updateOrderFulfillment(data, body = {}, dateText = todayISO()) {
  const order = findOrder(data, body);
  if (!order) {
    const error = new Error("订单不存在");
    error.code = 3004;
    throw error;
  }
  const fulfillment = ensureFulfillment(data, order);
  const deliveryStatus = body.deliveryStatus || body.delivery_status || fulfillment.delivery_status || order.delivery_status;
  fulfillment.receiver_name = body.receiverName || body.receiver_name || fulfillment.receiver_name || order.receiver_name || "";
  fulfillment.receiver_phone = normalizePhone(body.receiverPhone || body.receiver_phone || fulfillment.receiver_phone || order.receiver_phone || order.phone);
  fulfillment.carrier = body.carrier || fulfillment.carrier || "";
  fulfillment.tracking_no = body.trackingNo || body.tracking_no || fulfillment.tracking_no || "";
  fulfillment.delivery_status = deliveryStatus;
  fulfillment.shipped_at = body.shippedAt || body.shipped_at || fulfillment.shipped_at || "";
  fulfillment.delivered_at = body.deliveredAt || body.delivered_at || fulfillment.delivered_at || (deliveryStatus === "DELIVERED" ? nowISO() : "");
  fulfillment.last_event_text = body.lastEventText || body.last_event_text || fulfillment.last_event_text || "";
  fulfillment.updated_at = nowISO();
  order.delivery_status = deliveryStatus;

  let taskResult = null;
  if (order.user_id && deliveryStatus === "DELIVERED") {
    taskResult = createOperationTaskOnce(data, {
      task_type: "DELIVERED_NOT_STARTED",
      user_id: order.user_id,
      order_id: order.order_id,
      task_date: dateText,
      reason: "订单已送达但用户尚未开始 Day1",
      suggested_action: "通过企业微信提醒用户进入小程序开始打卡",
    });
  }
  if (order.user_id && deliveryStatus === "EXCEPTION") {
    taskResult = createOperationTaskOnce(data, {
      task_type: "FULFILLMENT_EXCEPTION",
      user_id: order.user_id,
      order_id: order.order_id,
      task_date: dateText,
      reason: "物流异常，需要人工确认",
      suggested_action: "核对运单并联系用户",
    });
  }
  return { order, fulfillment, task: taskResult ? taskResult.task : null };
}

function getOrderFulfillment(data, orderId) {
  return fulfillmentForOrder(data, orderId);
}

function getReadyToStartUsers(data, dateText = todayISO()) {
  return data.youzanOrders
    .filter((order) => {
      if (!order.user_id) return false;
      if (!data.users.some((user) => user.user_id === order.user_id)) return false;
      if (getOrderDeliveryStatus(data, order) !== "DELIVERED") return false;
      return !data.checkinSessions.some((session) => session.user_id === order.user_id && session.order_id === order.order_id);
    })
    .map((order) => ({
      user: data.users.find((user) => user.user_id === order.user_id) || null,
      order: toOrderPayload(data, order),
      date: dateText,
    }));
}

module.exports = {
  ensureFulfillment,
  getOrderDeliveryStatus,
  getOrderFulfillment,
  getReadyToStartUsers,
  syncManualOrder,
  toOrderPayload,
  updateOrderFulfillment,
};
