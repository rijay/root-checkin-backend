const { nowISO } = require("./dates");
const { createId } = require("./seed");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function identityError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function bindReceiverPhone(data, user, receiverPhone) {
  const phone = normalizePhone(receiverPhone);
  if (!phone) throw identityError(1002, "手机号必填");

  const identityLinks = ensureList(data, "identityLinks");
  const conflicts = identityLinks.filter((item) => item.receiver_phone === phone && item.user_id !== user.user_id);
  let link = identityLinks.find((item) => item.user_id === user.user_id && item.receiver_phone === phone);

  if (!link) {
    link = {
      identity_link_id: createId("idn"),
      user_id: user.user_id,
      receiver_phone: phone,
      external_contact_id: "",
      wechat_remark_name: "",
      match_confidence: "HIGH",
      warnings: [],
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    identityLinks.push(link);
  }

  link.receiver_phone = phone;
  link.match_confidence = conflicts.length ? "WARNING" : "HIGH";
  link.warnings = conflicts.length ? ["PHONE_BOUND_TO_OTHER_USER"] : [];
  link.updated_at = nowISO();
  return link;
}

function linkWechatLead(data, user, leadHint = {}) {
  const leadProfiles = ensureList(data, "leadProfiles");
  if (!leadHint.externalContactId && !leadHint.remarkName && !leadHint.sourceChannel) return null;

  let lead = leadProfiles.find((item) => item.user_id === user.user_id);
  if (!lead) {
    lead = {
      lead_id: createId("lead"),
      user_id: user.user_id,
      source_channel: "",
      offline_event_name: "",
      corp_wechat_status: "UNKNOWN",
      rule_sent_at: "",
      operator_note: "",
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    leadProfiles.push(lead);
  }

  lead.external_contact_id = leadHint.externalContactId || lead.external_contact_id || "";
  lead.wechat_remark_name = leadHint.remarkName || lead.wechat_remark_name || "";
  lead.source_channel = leadHint.sourceChannel || lead.source_channel || "";
  lead.offline_event_name = leadHint.offlineEventName || lead.offline_event_name || "";
  lead.corp_wechat_status = leadHint.corpWechatStatus || lead.corp_wechat_status || "UNKNOWN";
  lead.operator_note = leadHint.operatorNote || lead.operator_note || "";
  lead.updated_at = nowISO();
  return lead;
}

function getIdentityWarnings(data, userId) {
  return ensureList(data, "identityLinks")
    .filter((item) => item.user_id === userId)
    .flatMap((item) => item.warnings || []);
}

function identifyUser(data, user, body = {}) {
  const identityLink = body.phone ? bindReceiverPhone(data, user, body.phone) : null;
  const leadProfile = linkWechatLead(data, user, body.leadHint || {});
  return {
    identityLink,
    leadProfile,
    warnings: getIdentityWarnings(data, user.user_id),
  };
}

module.exports = {
  bindReceiverPhone,
  getIdentityWarnings,
  identifyUser,
  linkWechatLead,
  normalizePhone,
};
