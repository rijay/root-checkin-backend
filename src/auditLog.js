const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureAuditLogs(data) {
  if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
  return data.auditLogs;
}

function appendAuditLog(data, entry = {}) {
  const log = {
    audit_log_id: createId("aud"),
    action: entry.action || "UNKNOWN",
    target_type: entry.targetType || entry.target_type || "",
    target_id: entry.targetId || entry.target_id || "",
    operator_id: entry.operatorId || entry.operator_id || "",
    reason: entry.reason || "",
    before: entry.before || null,
    after: entry.after || null,
    metadata: entry.metadata || {},
    created_at: nowISO(),
  };
  ensureAuditLogs(data).unshift(log);
  data.auditLogs = ensureAuditLogs(data).slice(0, 500);
  return log;
}

function listAuditLogs(data, query = {}) {
  const targetType = query.targetType || query.target_type || "";
  const targetId = query.targetId || query.target_id || "";
  const action = query.action || "";
  const operatorId = query.operatorId || query.operator_id || "";
  const date = query.date || "";
  const q = String(query.q || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(query.limit || 50), 200));
  return ensureAuditLogs(data)
    .filter((log) => !targetType || log.target_type === targetType)
    .filter((log) => !targetId || log.target_id === targetId)
    .filter((log) => !action || log.action === action)
    .filter((log) => !operatorId || log.operator_id === operatorId)
    .filter((log) => !date || String(log.created_at || "").startsWith(date))
    .filter((log) => {
      if (!q) return true;
      const text = [
        log.action,
        log.target_type,
        log.target_id,
        log.operator_id,
        log.reason,
        JSON.stringify(log.before || {}),
        JSON.stringify(log.after || {}),
      ].join(" ").toLowerCase();
      return text.includes(q);
    })
    .slice(0, limit);
}

module.exports = {
  appendAuditLog,
  listAuditLogs,
};
