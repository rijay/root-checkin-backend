const orderFulfillment = require("./orderFulfillment");

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

const STATE_LABELS = {
  UNREGISTERED: "未完成画像",
  REGISTERED_IDLE: "待启动",
  CHECKIN_ACTIVE: "打卡中",
  CHECKIN_COMPLETED: "已完成七天",
  CHECKIN_FAILED: "需人工确认",
  DAILY_ACTIVE: "日常记录",
};

const DELIVERY_LABELS = {
  NOT_SHIPPED: "未发货",
  SHIPPED: "已发货",
  DELIVERED: "已签收",
  EXCEPTION: "物流异常",
};

function latestBy(items, key) {
  return items.slice().sort((left, right) => String(right[key] || "").localeCompare(String(left[key] || "")))[0] || null;
}

function userOrders(data, userId) {
  return (data.youzanOrders || []).filter((order) => order.user_id === userId);
}

function userSessions(data, userId) {
  return (data.checkinSessions || []).filter((session) => session.user_id === userId);
}

function latestSession(data, userId) {
  return latestBy(userSessions(data, userId), "created_at");
}

function latestOrder(data, userId) {
  return latestBy(userOrders(data, userId), "matched_at") || latestBy(userOrders(data, userId), "paid_at");
}

function userOpenTasks(data, userId) {
  return (data.operationTasks || []).filter((task) => task.user_id === userId && task.status === "OPEN");
}

function lastRecord(data, userId) {
  const checkinRecords = (data.checkinRecords || [])
    .filter((record) => record.user_id === userId)
    .map((record) => ({ date: record.checkin_date, label: `Day${record.day_index}`, feedback: record.feedback || "" }));
  const dailyRecords = (data.dailyCheckinRecords || [])
    .filter((record) => record.user_id === userId)
    .map((record) => ({ date: record.checkin_date, label: "日常记录", feedback: record.feedback || "" }));
  return checkinRecords.concat(dailyRecords).sort((left, right) => String(right.date).localeCompare(String(left.date)))[0] || null;
}

function totalRecordCount(data, userId) {
  return (data.checkinRecords || []).filter((record) => record.user_id === userId).length
    + (data.dailyCheckinRecords || []).filter((record) => record.user_id === userId).length;
}

function deliveryStatus(data, order) {
  return order ? orderFulfillment.getOrderDeliveryStatus(data, order) : "";
}

function currentSessionStatus(session) {
  if (!session) return "暂无周期";
  const labels = {
    ACTIVE: "打卡中",
    COMPLETED: "已完成",
    FAILED: "已失败",
    REFUNDED: "已免单",
  };
  return labels[session.status] || session.status || "暂无周期";
}

function buildUserBlockage(data, user) {
  const tasks = userOpenTasks(data, user.user_id);
  const manualTask = tasks.find((task) => task.task_type === "MANUAL_REVIEW_REQUIRED");
  const feedbackTask = tasks.find((task) => task.task_type === "FEEDBACK_FOLLOW");
  const order = latestOrder(data, user.user_id);
  const session = latestSession(data, user.user_id);
  const status = deliveryStatus(data, order);

  if (manualTask) return { blockage: "等待人工确认", nextAction: manualTask.reason || "核对订单、物流或启动资格", severity: "HIGH" };
  if (feedbackTask) return { blockage: "异常反馈待跟进", nextAction: feedbackTask.reason || "查看反馈并生成跟进记录", severity: "HIGH" };
  if (user.state === "UNREGISTERED") return { blockage: "未完成身体反馈画像", nextAction: "提醒用户完成授权和画像提交", severity: "MEDIUM" };
  if (!order) return { blockage: "暂无匹配订单", nextAction: "在订单匹配 tab 搜索或录入有赞订单", severity: "MEDIUM" };
  if (status === "EXCEPTION") return { blockage: "物流异常", nextAction: "核对运单并联系用户", severity: "HIGH" };
  if (status && status !== "DELIVERED") return { blockage: "等待物流送达", nextAction: "关注物流状态，送达后提醒开始记录", severity: "LOW" };
  if (status === "DELIVERED" && !session) return { blockage: "已送达未开始", nextAction: "提醒用户进入小程序开始记录", severity: "MEDIUM" };
  if (session && session.status === "ACTIVE") return { blockage: "打卡进行中", nextAction: "关注今日记录和异常反馈", severity: "LOW" };
  if (session && session.status === "COMPLETED") return { blockage: "七天已完成", nextAction: "查看 Day8 问卷、免单和复购意向", severity: "LOW" };
  if (user.state === "DAILY_ACTIVE") return { blockage: "日常记录中", nextAction: "关注连续记录和身体反馈", severity: "LOW" };
  return { blockage: "暂无明显卡点", nextAction: "保持观察", severity: "LOW" };
}

function buildAdminUserRow(data, user) {
  const order = latestOrder(data, user.user_id);
  const session = latestSession(data, user.user_id);
  const record = lastRecord(data, user.user_id);
  const tasks = userOpenTasks(data, user.user_id);
  const blockage = buildUserBlockage(data, user);
  const status = deliveryStatus(data, order);
  return {
    userId: user.user_id,
    nickname: user.nickname || "ROOT用户",
    phone: maskPhone(user.phone),
    state: user.state || "",
    stateLabel: STATE_LABELS[user.state] || user.state || "",
    currentStatus: currentSessionStatus(session),
    currentBlockage: blockage.blockage,
    nextAction: blockage.nextAction,
    severity: blockage.severity,
    latestOrderNo: order ? order.youzan_order_no : "",
    orderStatus: status || "NO_ORDER",
    orderStatusLabel: status ? DELIVERY_LABELS[status] || status : "暂无订单",
    latestCheckinDate: record ? record.date : "",
    latestCheckinLabel: record ? record.label : "",
    totalRecords: totalRecordCount(data, user.user_id),
    openTaskCount: tasks.length,
  };
}

function buildAdminUserRows(data) {
  return (data.users || [])
    .map((user) => buildAdminUserRow(data, user))
    .sort((left, right) => right.openTaskCount - left.openTaskCount || String(right.latestCheckinDate).localeCompare(String(left.latestCheckinDate)));
}

function buildAdminUserDetailSummary(data, userId) {
  const user = (data.users || []).find((item) => item.user_id === userId);
  if (!user) return null;
  return buildAdminUserRow(data, user);
}

module.exports = {
  buildAdminUserDetailSummary,
  buildAdminUserRows,
};
