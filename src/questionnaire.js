const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFAULT_DEFINITIONS = [
  {
    questionnaire_type: "DAY4_MIDPOINT",
    version: 1,
    active: true,
    skip_allowed: true,
    required_fields: ["stoolChange", "comfortScore"],
    questions: [
      { field: "stoolChange", type: "single", title: "这几天排便状态有什么变化？", options: ["better", "same", "worse"] },
      { field: "comfortScore", type: "scale", title: "整体舒适度", min: 1, max: 5 },
      { field: "needsContact", type: "boolean", title: "是否希望运营联系你？" },
      { field: "feedback", type: "text", title: "还有什么想补充？", required: false },
    ],
  },
  {
    questionnaire_type: "DAY8_SUMMARY",
    version: 1,
    active: true,
    skip_allowed: false,
    required_fields: ["overallFeeling", "repurchaseIntent"],
    questions: [
      { field: "overallFeeling", type: "single", title: "7 天整体感受", options: ["better", "same", "worse"] },
      { field: "repurchaseIntent", type: "single", title: "是否愿意继续使用？", options: ["yes", "maybe", "no"] },
      { field: "needsContact", type: "boolean", title: "是否希望运营联系你？" },
      { field: "feedback", type: "text", title: "收尾反馈", required: false },
    ],
  },
];

function ensureDefinitions(data) {
  if (!Array.isArray(data.questionnaireDefinitions)) data.questionnaireDefinitions = [];
  DEFAULT_DEFINITIONS.forEach((definition) => {
    const exists = data.questionnaireDefinitions.some((item) => {
      return item.questionnaire_type === definition.questionnaire_type && item.version === definition.version;
    });
    if (!exists) data.questionnaireDefinitions.push({ ...definition, questions: definition.questions.map((item) => ({ ...item })) });
  });
  return data.questionnaireDefinitions;
}

function ensureResponses(data) {
  if (!Array.isArray(data.questionnaireResponses)) data.questionnaireResponses = [];
  return data.questionnaireResponses;
}

function getQuestionnaire(data, type) {
  const definition = ensureDefinitions(data)
    .filter((item) => item.questionnaire_type === type && item.active)
    .sort((left, right) => right.version - left.version)[0];
  if (!definition) {
    const error = new Error("问卷不存在");
    error.code = 6001;
    throw error;
  }
  return definition;
}

function getResponse(data, userId, sessionId, type) {
  return ensureResponses(data).find((item) => {
    return item.user_id === userId && item.session_id === sessionId && item.questionnaire_type === type;
  }) || null;
}

function validateQuestionnaireAnswers(definition, answers = {}) {
  const required = definition.required_fields || [];
  required.forEach((field) => {
    if (answers[field] === undefined || answers[field] === null || answers[field] === "") {
      const error = new Error("问卷必填项未完成");
      error.code = 6002;
      throw error;
    }
  });
  definition.questions.forEach((question) => {
    const value = answers[question.field];
    if (value === undefined || value === null || value === "") return;
    if (question.type === "scale") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < question.min || number > question.max) {
        const error = new Error("问卷分值超出范围");
        error.code = 6003;
        throw error;
      }
    }
    if (question.type === "boolean" && typeof value !== "boolean") {
      const error = new Error("问卷布尔题格式错误");
      error.code = 6004;
      throw error;
    }
  });
}

function requiresFollow(response) {
  const answers = response.answers || {};
  return Boolean(answers.needsContact || answers.overallFeeling === "worse" || answers.stoolChange === "worse");
}

function submitQuestionnaire(data, user, session, body = {}) {
  if (!session) {
    const error = new Error("暂无打卡周期");
    error.code = 4001;
    throw error;
  }
  const type = body.type || body.questionnaireType || body.questionnaire_type;
  const definition = getQuestionnaire(data, type);
  const idempotencyKey = body.idempotencyKey || body.idempotency_key || "";
  const existingByKey = idempotencyKey
    ? ensureResponses(data).find((item) => item.idempotency_key === idempotencyKey)
    : null;
  if (existingByKey) return { response: existingByKey, created: false };

  const existing = getResponse(data, user.user_id, session.session_id, type);
  if (existing) return { response: existing, created: false };

  const answers = body.answers || {};
  validateQuestionnaireAnswers(definition, answers);
  const response = {
    response_id: createId("qrs"),
    user_id: user.user_id,
    session_id: session.session_id,
    questionnaire_type: definition.questionnaire_type,
    version: definition.version,
    answers,
    submitted_at: nowISO(),
    needs_follow: false,
    idempotency_key: idempotencyKey,
  };
  response.needs_follow = requiresFollow(response);
  ensureResponses(data).push(response);
  return { response, created: true };
}

function getQuestionnaireStatus(data, userId, sessionId) {
  const responses = ensureResponses(data).filter((item) => item.user_id === userId && item.session_id === sessionId);
  return {
    DAY4_MIDPOINT: Boolean(responses.find((item) => item.questionnaire_type === "DAY4_MIDPOINT")),
    DAY8_SUMMARY: Boolean(responses.find((item) => item.questionnaire_type === "DAY8_SUMMARY")),
    responses,
  };
}

module.exports = {
  DEFAULT_DEFINITIONS,
  getQuestionnaire,
  getQuestionnaireStatus,
  getResponse,
  requiresFollow,
  submitQuestionnaire,
  validateQuestionnaireAnswers,
};
