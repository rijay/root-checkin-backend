const { nowISO } = require("./dates");
const externalAdapterSamples = require("./externalAdapterSamples");

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function makeCheck(id, label, status, message, detail = {}) {
  return { id, label, status, message, detail };
}

function getEnv(env, names) {
  for (const name of names) {
    if (env && env[name]) return String(env[name]);
  }
  return "";
}

function storeCheck(storeAdapter, target) {
  const kind = storeAdapter && storeAdapter.kind ? storeAdapter.kind : "memory";
  if (target === "production") {
    if (kind === "memory") {
      return makeCheck("store_adapter", "数据仓库 Adapter", "BLOCKER", "正式上线不能使用内存 Adapter，重启会丢失用户和订单记录。", { kind });
    }
    if (kind === "json-file") {
      return makeCheck("store_adapter", "数据仓库 Adapter", "BLOCKER", "JSON 文件 Adapter 只适合内部灰度，正式上线缺少并发、备份、迁移和审计能力。", { kind });
    }
    if (kind === "sqlite") {
      return makeCheck("store_adapter", "数据仓库 Adapter", "BLOCKER", "SQLite Adapter 只适合本地验证或极小范围灰度；云托管正式环境重启、扩容或迁移时可能丢失 /tmp 数据，0.4.0 正式上线必须切换 MySQL Adapter。", { kind });
    }
    if (kind === "mysql") {
      return makeCheck("store_adapter", "数据仓库 Adapter", "PASS", "已启用 MySQL 持久化 Adapter，可支撑云托管正式环境重启后的用户、订单和运营状态保留。", { kind });
    }
    return makeCheck("store_adapter", "数据仓库 Adapter", "BLOCKER", "0.4.0 正式上线要求使用 MySQL Adapter，并完成备份与回滚验证。", { kind });
  }

  if (kind === "memory") {
    return makeCheck("store_adapter", "数据仓库 Adapter", "WARNING", "当前为内存 Adapter，只适合演示；运营试跑建议设置 ROOT_STORE_FILE 或 ROOT_STORE_ADAPTER=mysql。", { kind });
  }
  return makeCheck("store_adapter", "数据仓库 Adapter", "PASS", "当前 Adapter 可支撑内部灰度试跑。", { kind });
}

function wechatCheck(env, target) {
  const appid = getEnv(env, ["WECHAT_APPID", "WX_APPID"]);
  const secret = getEnv(env, ["WECHAT_APPSECRET", "WECHAT_SECRET", "WX_SECRET"]);
  if (appid && secret) {
    return makeCheck("wechat_credentials", "微信登录密钥", "PASS", "已配置微信登录所需密钥。", { hasAppid: true, hasSecret: true });
  }
  const status = target === "production" ? "BLOCKER" : "WARNING";
  return makeCheck("wechat_credentials", "微信登录密钥", status, "未配置 WECHAT_APPID / WECHAT_APPSECRET 时，正式手机号授权登录无法完成。", {
    hasAppid: Boolean(appid),
    hasSecret: Boolean(secret),
  });
}

function domainCheck(env, target) {
  const publicBaseUrl = getEnv(env, ["ROOT_PUBLIC_BASE_URL", "PUBLIC_BASE_URL"]);
  if (!publicBaseUrl) {
    return makeCheck(
      "public_base_url",
      "正式域名",
      target === "production" ? "BLOCKER" : "WARNING",
      "未配置 ROOT_PUBLIC_BASE_URL；小程序体验版和正式版不能使用 127.0.0.1。",
      { publicBaseUrl: "" }
    );
  }
  if (!publicBaseUrl.startsWith("https://") || publicBaseUrl.includes("example.com")) {
    return makeCheck("public_base_url", "正式域名", "BLOCKER", "正式域名必须是可访问的 HTTPS 合法域名，且不能保留 example.com 占位。", { publicBaseUrl });
  }
  return makeCheck("public_base_url", "正式域名", "PASS", "已配置 HTTPS 正式域名。", { publicBaseUrl });
}

function adminAccessCheck(env, target) {
  const configured = Boolean(getEnv(env, ["ROOT_ADMIN_TOKEN", "ROOT_ADMIN_TOKENS"]));
  if (configured) {
    return makeCheck("admin_access", "后台访问口令", "PASS", "已配置后台访问口令，运营数据 Interface 会拒绝未授权请求。", { configured });
  }
  return makeCheck(
    "admin_access",
    "后台访问口令",
    target === "production" ? "BLOCKER" : "WARNING",
    "未配置 ROOT_ADMIN_TOKEN 或 ROOT_ADMIN_TOKENS；正式环境后台运营数据不能裸露访问。",
    { configured }
  );
}

function sampleReadinessCheck(sourceReadiness, target) {
  if (sourceReadiness.status === "READY") {
    return makeCheck(
      `sample_${sourceReadiness.sourceType}`,
      `${sourceReadiness.label}样本评审`,
      "PASS",
      "样本数量、必填字段和状态枚举已达到 Adapter 开发准入。",
      sourceReadiness
    );
  }
  if (sourceReadiness.status === "NEEDS_REVIEW") {
    return makeCheck(
      `sample_${sourceReadiness.sourceType}`,
      `${sourceReadiness.label}样本评审`,
      "WARNING",
      "最新样本可继续，但仍有提醒项需要运营/产品确认。",
      sourceReadiness
    );
  }

  const strictReasonCodes = new Set(["NEEDS_MAPPING", "REVIEW_BLOCKED", "REQUIRED_FIELD_COVERAGE"]);
  const hasStrictReason = (sourceReadiness.blockingReasons || []).some((reason) => strictReasonCodes.has(reason.code));
  const status = target === "production" || hasStrictReason ? "BLOCKER" : "WARNING";
  const reasonText = (sourceReadiness.blockingReasons || []).map((reason) => reason.message).join("；") || "样本评审未达到准入";
  return makeCheck(
    `sample_${sourceReadiness.sourceType}`,
    `${sourceReadiness.label}样本评审`,
    status,
    reasonText,
    sourceReadiness
  );
}

function summarize(checks) {
  const blockers = checks.filter((item) => item.status === "BLOCKER").length;
  const warnings = checks.filter((item) => item.status === "WARNING").length;
  const passed = checks.filter((item) => item.status === "PASS").length;
  return {
    blockers,
    warnings,
    passed,
    total: checks.length,
  };
}

function buildLaunchReadiness(data, options = {}) {
  const target = normalizeTarget(options.target);
  const env = options.env || process.env;
  const adapterReadiness = externalAdapterSamples.buildAdapterReadiness(data, { requiredSamples: 3 });
  const checks = [
    storeCheck(options.storeAdapter, target),
    wechatCheck(env, target),
    domainCheck(env, target),
    adminAccessCheck(env, target),
    ...adapterReadiness.sources.map((source) => sampleReadinessCheck(source, target)),
  ];
  const summary = summarize(checks);
  const status = summary.blockers > 0 ? "BLOCKED" : summary.warnings > 0 ? "NEEDS_REVIEW" : "READY";
  return {
    target,
    status,
    generatedAt: nowISO(),
    summary,
    adapterReadiness,
    checks,
  };
}

module.exports = {
  buildLaunchReadiness,
};
