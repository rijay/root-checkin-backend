const orderFulfillment = require("./orderFulfillment");

const TASK_PRIORITY = {
  FULFILLMENT_EXCEPTION: { rank: 10, label: "物流异常", level: "高", tone: "danger" },
  MANUAL_REVIEW_REQUIRED: { rank: 20, label: "需要人工确认", level: "高", tone: "danger" },
  FEEDBACK_FOLLOW: { rank: 30, label: "异常反馈跟进", level: "高", tone: "danger" },
  REFUND_PENDING: { rank: 40, label: "免单待审核", level: "中高", tone: "warning" },
  DELIVERED_NOT_STARTED: { rank: 50, label: "已送达待开始", level: "中", tone: "warning" },
  MISSED_CHECKIN: { rank: 60, label: "今日未打卡", level: "中", tone: "warning" },
  MISSED_CHECKIN_STREAK: { rank: 65, label: "连续未打卡", level: "中", tone: "warning" },
  DAY4_QUESTIONNAIRE_PENDING: { rank: 70, label: "Day4 问卷待完成", level: "中", tone: "normal" },
  DAY8_QUESTIONNAIRE_PENDING: { rank: 75, label: "Day8 问卷待完成", level: "中", tone: "normal" },
  COUPON_UNUSED: { rank: 90, label: "优惠券未使用", level: "低", tone: "normal" },
  REPURCHASE_INTENT: { rank: 95, label: "复购意向", level: "低", tone: "normal" },
  LEAD_NEEDS_MATCHING: { rank: 55, label: "线索待匹配", level: "中", tone: "warning" },
};

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function publicUser(user) {
  if (!user) return null;
  return {
    userId: user.user_id,
    nickname: user.nickname || "ROOT用户",
    phone: maskPhone(user.phone),
    state: user.state || "",
  };
}

function findUser(data, userId) {
  return data.users.find((user) => user.user_id === userId) || null;
}

function findOrder(data, orderId) {
  return data.youzanOrders.find((order) => order.order_id === orderId) || null;
}

function buildTaskPriority(task = {}) {
  return TASK_PRIORITY[task.task_type || task.taskType] || {
    rank: 80,
    label: task.task_type || task.taskType || "运营待办",
    level: "中",
    tone: "normal",
  };
}

function taskToOpsItem(data, task) {
  const priority = buildTaskPriority(task);
  const user = findUser(data, task.user_id);
  const order = findOrder(data, task.order_id);
  return {
    taskId: task.task_id,
    taskType: task.task_type,
    label: priority.label,
    priorityLevel: priority.level,
    priorityRank: priority.rank,
    tone: priority.tone,
    status: task.status || "OPEN",
    reason: task.reason || "",
    suggestedAction: task.suggested_action || "复制跟进话术，人工确认后标记状态",
    suggestedScript: task.suggested_script || "您好，我来确认一下今天的 ROOT 记录情况。",
    taskDate: task.task_date || "",
    user: publicUser(user),
    order: order ? orderFulfillment.toOrderPayload(data, order) : null,
  };
}

function openTasks(data) {
  return (data.operationTasks || []).filter((task) => task.status === "OPEN");
}

function buildOpsMetrics(data, summary = {}) {
  const tasks = openTasks(data);
  const pendingOrders = (data.youzanOrders || []).filter((order) => !order.user_id);
  const refundPending = (data.refundWorkItems || []).filter((item) => item.status === "PENDING");
  const readyToStart = orderFulfillment.getReadyToStartUsers(data);
  const riskFeedbacks = buildRiskFeedbackSummary(data);
  return [
    { key: "dueToday", label: "今日应打卡", value: summary.dueToday || 0, tab: "today" },
    { key: "checkedToday", label: "今日已打卡", value: summary.checkedToday || 0, tab: "feedback" },
    { key: "missedToday", label: "今日未打卡", value: summary.missedToday || 0, tab: "today", filter: "MISSED_CHECKIN" },
    { key: "openTasks", label: "待处理任务", value: tasks.length, tab: "today" },
    { key: "pendingOrders", label: "待匹配订单", value: pendingOrders.length, tab: "orders" },
    { key: "refundPending", label: "待审核免单", value: refundPending.length, tab: "refund" },
    { key: "readyToStart", label: "已送达待开始", value: readyToStart.length, tab: "users" },
    { key: "riskFeedbacks", label: "异常反馈", value: riskFeedbacks.length, tab: "feedback" },
  ];
}

function buildPendingOrders(data) {
  return (data.youzanOrders || [])
    .filter((order) => !order.user_id)
    .map((order) => orderFulfillment.toOrderPayload(data, order));
}

function abnormalStool(stoolType) {
  return ["type1", "type6", "type7"].includes(stoolType);
}

function buildRiskFeedbackSummary(data) {
  const checkinItems = (data.checkinRecords || [])
    .filter((record) => record.feedback || abnormalStool(record.stool_type))
    .map((record) => ({
      sourceType: "CHECKIN_RECORD",
      sourceId: record.record_id,
      user: publicUser(findUser(data, record.user_id)),
      title: `Day${record.day_index || "-"} 打卡反馈`,
      date: record.checkin_date || "",
      text: record.feedback || "便型需要关注",
      tone: abnormalStool(record.stool_type) ? "danger" : "warning",
    }));
  const questionnaireItems = (data.questionnaireResponses || [])
    .filter((item) => item.needs_follow)
    .map((item) => ({
      sourceType: "QUESTIONNAIRE_RESPONSE",
      sourceId: item.response_id,
      user: publicUser(findUser(data, item.user_id)),
      title: item.questionnaire_type || "问卷反馈",
      date: item.submitted_at || "",
      text: item.answers && (item.answers.feedback || item.answers.note) ? item.answers.feedback || item.answers.note : "问卷需要跟进",
      tone: "danger",
    }));
  const dailyItems = (data.dailyCheckinRecords || [])
    .filter((record) => record.feedback || abnormalStool(record.stool_type))
    .map((record) => ({
      sourceType: "DAILY_CHECKIN_RECORD",
      sourceId: record.record_id,
      user: publicUser(findUser(data, record.user_id)),
      title: "日常记录反馈",
      date: record.checkin_date || "",
      text: record.feedback || "便型需要关注",
      tone: abnormalStool(record.stool_type) ? "danger" : "warning",
    }));
  return checkinItems
    .concat(questionnaireItems, dailyItems)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function buildRefundPreview(data) {
  return (data.refundWorkItems || [])
    .filter((item) => item.status === "PENDING")
    .map((item) => ({
      refundWorkItemId: item.refund_work_item_id,
      user: publicUser(findUser(data, item.user_id)),
      youzanOrderNo: item.youzan_order_no || "",
      amount: item.amount || 0,
      status: item.status || "",
      reason: "等待运营审核免单",
    }));
}

function buildOpsDashboard(data, summary = {}) {
  const priorityTasks = openTasks(data)
    .map((task) => taskToOpsItem(data, task))
    .sort((left, right) => left.priorityRank - right.priorityRank || String(left.taskDate).localeCompare(String(right.taskDate)));
  return {
    metrics: buildOpsMetrics(data, summary),
    priorityTasks,
    pendingOrders: buildPendingOrders(data),
    refundPreview: buildRefundPreview(data),
    riskFeedbacks: buildRiskFeedbackSummary(data),
    readyToStartUsers: orderFulfillment.getReadyToStartUsers(data),
  };
}

module.exports = {
  buildOpsDashboard,
  buildOpsMetrics,
  buildRiskFeedbackSummary,
  buildTaskPriority,
};
