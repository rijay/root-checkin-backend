const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");

const TERMINAL_STATUSES = new Set(["DONE", "SKIPPED"]);

function ensureList(data) {
  if (!Array.isArray(data.operationTasks)) data.operationTasks = [];
  return data.operationTasks;
}

function sameTask(left, right) {
  return (
    left.task_type === right.task_type &&
    (left.user_id || "") === (right.user_id || "") &&
    (left.order_id || "") === (right.order_id || "") &&
    left.task_date === right.task_date &&
    (left.dedupe_key || "") === (right.dedupe_key || "")
  );
}

function createOperationTaskOnce(data, task) {
  const operationTasks = ensureList(data);
  const candidate = {
    task_type: task.task_type || task.taskType,
    user_id: task.user_id || task.userId || "",
    order_id: task.order_id || task.orderId || "",
    task_date: task.task_date || task.taskDate || todayISO(),
    dedupe_key: task.dedupe_key || task.dedupeKey || "",
  };
  const existing = operationTasks.find((item) => sameTask(item, candidate));
  if (existing) return { task: existing, created: false };

  const next = {
    task_id: createId("tsk"),
    ...candidate,
    status: "OPEN",
    reason: task.reason || "",
    suggested_action: task.suggested_action || task.suggestedAction || "",
    suggested_script: task.suggested_script || task.suggestedScript || "",
    metadata: task.metadata || {},
    created_at: nowISO(),
    completed_at: "",
    result: "",
    note: "",
  };
  operationTasks.push(next);
  return { task: next, created: true };
}

function taskMatchesQuery(task, query = {}) {
  const status = query.status || query.taskStatus || query.task_status;
  const taskType = query.taskType || query.task_type;
  const userId = query.userId || query.user_id;
  const orderId = query.orderId || query.order_id;
  const taskDate = query.taskDate || query.task_date;

  if (status && task.status !== status) return false;
  if (taskType && task.task_type !== taskType) return false;
  if (userId && task.user_id !== userId) return false;
  if (orderId && task.order_id !== orderId) return false;
  if (taskDate && task.task_date !== taskDate) return false;
  return true;
}

function listOperationTasks(data, query = {}) {
  return ensureList(data).filter((task) => {
    return taskMatchesQuery(task, query);
  });
}

function listOpenOperationTasks(data, query = {}) {
  return listOperationTasks(data, { ...query, status: "OPEN" });
}

function completeOperationTask(data, taskId, body = {}) {
  const task = ensureList(data).find((item) => item.task_id === taskId);
  if (!task) {
    const error = new Error("待办不存在");
    error.code = 404;
    error.status = 404;
    throw error;
  }
  const status = body.status || "DONE";
  if (status !== "DONE" && status !== "SKIPPED") {
    const error = new Error("待办状态只能是 DONE 或 SKIPPED");
    error.code = 400;
    error.status = 400;
    throw error;
  }
  if (TERMINAL_STATUSES.has(task.status)) return task;
  task.status = status;
  task.completed_at = nowISO();
  task.result = body.result || task.result || "";
  task.note = body.note || task.note || "";
  return task;
}

function skipOperationTask(data, taskId, body = {}) {
  return completeOperationTask(data, taskId, { ...body, status: "SKIPPED" });
}

module.exports = {
  completeOperationTask,
  createOperationTaskOnce,
  listOperationTasks,
  listOpenOperationTasks,
  skipOperationTask,
};
