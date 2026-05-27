const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createMemoryStore } = require("./store");
const {
  adminDashboard,
  adminLaunchReadiness,
  applyCorrection,
  applyRefund,
  approveRefund,
  claimCoupon,
  completeOperationTask,
  confirmAdminOrderMatch,
  confirmImport,
  continueAsDailyUser,
  createFeedbackFollowTask,
  createStore,
  dailyHistory,
  dailyStats,
  dailyTrend,
  getProfile,
  getAdapterCalibration,
  getCouponStatus,
  getExternalAdapters,
  getExternalSampleTemplate,
  getAdminUserDetail,
  getImportBatch,
  exportImportFailuresCsv,
  getQuestionnaire,
  getQuestionnaireStatus,
  getReadyToStartUsers,
  getReleaseRecord,
  getUserOrders,
  getRecordDetail,
  getRecordList,
  getRefundStatus,
  getSession,
  getUserState,
  importExternalSamples,
  loginWithWechat,
  listImportBatches,
  listAuditLogs,
  listOperationTasks,
  markCouponUsed,
  matchOrder,
  previewAdminOrderMatch,
  previewCorrection,
  previewExternalSamples,
  previewImport,
  recordCouponRepurchaseClick,
  resolveManualReview,
  runExternalAdapter,
  runDailyAudit,
  searchAdminOrderMatching,
  startCheckin,
  syncManualOrder,
  submitCheckin,
  submitDailyCheckin,
  submitProfile,
  submitQuestionnaire,
  trackEvent,
  updateDisplayProfile,
  updateOrderFulfillment,
  upsertExternalStatusMapping,
  uploadImage,
} = require("./domain");

const publicDir = path.join(__dirname, "..", "public");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024 * 2) {
        reject(Object.assign(new Error("请求体过大"), { status: 413, code: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error("JSON格式错误"), { status: 400, code: 400 }));
      }
    });
  });
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id,X-Admin-Token,X-ROOT-ADMIN-TOKEN",
    "Content-Type": typeof payload === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function ok(res, payload) {
  send(res, 200, payload);
}

function getToken(req) {
  const header = req.headers.authorization || "";
  const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
  return token || "";
}

function getAdminToken(req) {
  const header = req.headers.authorization || "";
  const [, bearerToken] = header.match(/^Bearer\s+(.+)$/i) || [];
  return String(req.headers["x-root-admin-token"] || req.headers["x-admin-token"] || bearerToken || "");
}

function parseAdminTokens(env = process.env) {
  const entries = [];
  let configured = Boolean(env.ROOT_ADMIN_TOKEN);
  if (env.ROOT_ADMIN_TOKENS) {
    configured = true;
    try {
      const parsed = JSON.parse(env.ROOT_ADMIN_TOKENS);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && item.token) entries.push({
            token: String(item.token),
            operatorId: String(item.operatorId || item.operator_id || item.name || "operator"),
            role: String(item.role || "operator"),
          });
        });
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([operatorId, value]) => {
          if (typeof value === "string") {
            entries.push({ token: value, operatorId, role: "operator" });
            return;
          }
          if (value && value.token) entries.push({
            token: String(value.token),
            operatorId,
            role: String(value.role || "operator"),
          });
        });
      }
    } catch (error) {
      // Malformed multi-token config falls through to ROOT_ADMIN_TOKEN.
    }
  }
  if (env.ROOT_ADMIN_TOKEN) entries.push({ token: String(env.ROOT_ADMIN_TOKEN), operatorId: "admin", role: "admin" });
  return { entries, configured };
}

function getAdminPrincipal(req, env = process.env) {
  const { entries, configured } = parseAdminTokens(env);
  if (!configured) return { operatorId: "local-admin", role: "admin", tokenConfigured: false };
  if (!entries.length) return null;
  const token = getAdminToken(req);
  const matched = entries.find((entry) => entry.token === token);
  return matched ? { operatorId: matched.operatorId, role: matched.role, tokenConfigured: true } : null;
}

function requiresAdminAccess(pathname) {
  return pathname.startsWith("/api/v1/admin/") || pathname === "/api/v1/jobs/daily-audit";
}

function hasAdminAccess(req, env = process.env) {
  return Boolean(getAdminPrincipal(req, env));
}

function adminOperatorId(principal, body = {}) {
  if (principal && principal.tokenConfigured) return principal.operatorId;
  return body.operatorId || body.operator_id || (principal ? principal.operatorId : "");
}

function withIdempotency(data, req, action) {
  const requestId = req.headers["x-request-id"];
  if (!requestId) return action();
  if (data.idempotency[requestId]) return data.idempotency[requestId];
  const result = action();
  data.idempotency[requestId] = result;
  return result;
}

function staticFile(filePath, res) {
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.join(publicDir, safePath);
  if (!absolute.startsWith(publicDir) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
    return true;
  }
  const ext = path.extname(absolute);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": types[ext] || "application/octet-stream",
  });
  fs.createReadStream(absolute).pipe(res);
  return true;
}

function createApp(options = {}) {
  const storeAdapter = options.storeAdapter || createMemoryStore(options.store || createStore());
  const data = storeAdapter.data;
  const runtimeContext = { storeAdapter, env: options.env || process.env };
  function persistStore() {
    try {
      const result = storeAdapter.save();
      if (result && typeof result.catch === "function") {
        result.catch((error) => {
          console.error("Store save failed:", error.message);
        });
      }
    } catch (error) {
      console.error("Store save failed:", error.message);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const method = req.method || "GET";
    if (url.pathname.startsWith("/api/") && typeof storeAdapter.save === "function") {
      res.once("finish", persistStore);
    }

    if (method === "OPTIONS") return send(res, 204, "");
    if (method === "GET" && url.pathname === "/health") return ok(res, { code: 0, message: "ok", data: { service: "root-checkin" } });
    if (method === "GET" && ["/", "/admin", "/admin/"].includes(url.pathname)) return staticFile("admin.html", res);
    if (method === "GET" && url.pathname.startsWith("/assets/")) return staticFile(url.pathname.slice(1), res);
    if (method === "GET" && ["/admin.css", "/admin.js"].includes(url.pathname)) return staticFile(url.pathname.slice(1), res);
    if (requiresAdminAccess(url.pathname) && !hasAdminAccess(req, runtimeContext.env)) {
      return send(res, 401, { code: 40101, message: "请先输入后台访问口令", data: null });
    }

    try {
      const token = getToken(req);
      const adminPrincipal = requiresAdminAccess(url.pathname) ? getAdminPrincipal(req, runtimeContext.env) : null;
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
      const route = `${method} ${url.pathname}`;

      if (route === "POST /api/v1/auth/login") {
        return ok(res, await withIdempotency(data, req, () => loginWithWechat(data, body, {
          env: runtimeContext.env,
          headers: req.headers,
        })));
      }
      if (route === "GET /api/v1/user/state") return ok(res, getUserState(data, token));
      if (route === "GET /api/v1/user/profile") return ok(res, getProfile(data, token));
      if (route === "GET /api/v1/user/orders") return ok(res, getUserOrders(data, token));
      if (route === "POST /api/v1/user/profile") return ok(res, withIdempotency(data, req, () => submitProfile(data, token, body)));
      if (route === "POST /api/v1/user/display-profile") return ok(res, withIdempotency(data, req, () => updateDisplayProfile(data, token, body)));
      if (route === "POST /api/v1/order/match") return ok(res, withIdempotency(data, req, () => matchOrder(data, token, body)));
      if (route === "POST /api/v1/checkin/start") return ok(res, withIdempotency(data, req, () => startCheckin(data, token, body)));
      if (route === "GET /api/v1/checkin/session") return ok(res, getSession(data, token));
      if (route === "POST /api/v1/checkin/submit") return ok(res, withIdempotency(data, req, () => submitCheckin(data, token, body)));
      if (route === "GET /api/v1/checkin/records") return ok(res, getRecordList(data, token));
      if (method === "GET" && url.pathname.startsWith("/api/v1/checkin/records/")) {
        return ok(res, getRecordDetail(data, token, url.pathname.split("/").pop()));
      }
      if (route === "GET /api/v1/questionnaire") return ok(res, getQuestionnaire(data, token, url.searchParams.get("type")));
      if (route === "GET /api/v1/questionnaire/status") return ok(res, getQuestionnaireStatus(data, token));
      if (route === "POST /api/v1/questionnaire/submit") return ok(res, withIdempotency(data, req, () => submitQuestionnaire(data, token, body)));
      if (route === "POST /api/v1/refund/apply") return ok(res, withIdempotency(data, req, () => applyRefund(data, token)));
      if (route === "GET /api/v1/refund/status") return ok(res, getRefundStatus(data, token));
      if (route === "GET /api/v1/coupon/status") return ok(res, getCouponStatus(data, token));
      if (route === "POST /api/v1/coupon/claim") return ok(res, withIdempotency(data, req, () => claimCoupon(data, token, body)));
      if (route === "POST /api/v1/coupon/repurchase-click") return ok(res, recordCouponRepurchaseClick(data, token, body));
      if (route === "POST /api/v1/user/continue-daily") return ok(res, withIdempotency(data, req, () => continueAsDailyUser(data, token)));
      if (route === "GET /api/v1/daily/stats") return ok(res, dailyStats(data, token));
      if (route === "POST /api/v1/daily/submit") return ok(res, withIdempotency(data, req, () => submitDailyCheckin(data, token, body)));
      if (route === "GET /api/v1/daily/history") return ok(res, dailyHistory(data, token, Object.fromEntries(url.searchParams)));
      if (route === "GET /api/v1/daily/trend") return ok(res, dailyTrend(data, token, url.searchParams.get("range") || "7d"));
      if (route === "POST /api/v1/event/track") return ok(res, trackEvent(data, token, body));
      if (route === "POST /api/v1/upload/image") return ok(res, uploadImage(data, token, body));
      if (route === "POST /api/v1/jobs/daily-audit") return ok(res, runDailyAudit(data, body.date));
      if (route === "GET /api/v1/admin/dashboard") return ok(res, adminDashboard(data, runtimeContext));
      if (route === "GET /api/v1/admin/launch-readiness") {
        return ok(res, adminLaunchReadiness(data, { ...runtimeContext, target: url.searchParams.get("target") || "production" }));
      }
      if (route === "GET /api/v1/admin/ready-to-start") return ok(res, getReadyToStartUsers(data, url.searchParams.get("date") || undefined));
      if (route === "GET /api/v1/admin/tasks") return ok(res, listOperationTasks(data, Object.fromEntries(url.searchParams)));
      if (route === "GET /api/v1/admin/order-matching/search") return ok(res, searchAdminOrderMatching(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/order-matching/preview") return ok(res, previewAdminOrderMatch(data, body));
      if (route === "POST /api/v1/admin/order-matching/confirm") return ok(res, withIdempotency(data, req, () => confirmAdminOrderMatch(data, body)));
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/users/") && url.pathname.endsWith("/detail")) {
        const userId = url.pathname.split("/").at(-2);
        return ok(res, getAdminUserDetail(data, userId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/users/") && url.pathname.endsWith("/follow")) {
        const userId = url.pathname.split("/").at(-2);
        return ok(res, createFeedbackFollowTask(data, userId, body));
      }
      if (route === "POST /api/v1/admin/orders/sync") return ok(res, withIdempotency(data, req, () => syncManualOrder(data, body)));
      if (route === "POST /api/v1/admin/orders/fulfillment") return ok(res, withIdempotency(data, req, () => updateOrderFulfillment(data, body)));
      if (route === "GET /api/v1/admin/adapter-calibration") return ok(res, getAdapterCalibration(data, runtimeContext));
      if (route === "GET /api/v1/admin/release-record") {
        return ok(res, getReleaseRecord(data, { ...runtimeContext, target: url.searchParams.get("target") || "production" }));
      }
      if (route === "GET /api/v1/admin/external-adapters") return ok(res, getExternalAdapters(data, runtimeContext));
      if (route === "POST /api/v1/admin/external-adapters/run") {
        return ok(res, await withIdempotency(data, req, () => runExternalAdapter(data, body, runtimeContext)));
      }
      if (route === "GET /api/v1/admin/external-samples/template") return ok(res, getExternalSampleTemplate(url.searchParams.get("sourceType") || ""));
      if (route === "POST /api/v1/admin/external-samples/preview") return ok(res, previewExternalSamples(data, body));
      if (route === "POST /api/v1/admin/external-samples/import") return ok(res, withIdempotency(data, req, () => importExternalSamples(data, body)));
      if (route === "GET /api/v1/admin/imports") return ok(res, listImportBatches(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/imports/preview") return ok(res, withIdempotency(data, req, () => previewImport(data, body)));
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/imports/") && url.pathname.endsWith("/failures.csv")) {
        const batchId = url.pathname.split("/").at(-2);
        return send(res, 200, exportImportFailuresCsv(data, batchId), {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${batchId}-failures.csv"`,
        });
      }
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/imports/")) {
        const batchId = url.pathname.split("/").at(-1);
        return ok(res, getImportBatch(data, batchId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/imports/") && url.pathname.endsWith("/confirm")) {
        const batchId = url.pathname.split("/").at(-2);
        return ok(res, withIdempotency(data, req, () => confirmImport(data, batchId, { ...body, operatorId: adminOperatorId(adminPrincipal, body) })));
      }
      if (route === "POST /api/v1/admin/corrections/preview") return ok(res, previewCorrection(data, body));
      if (route === "POST /api/v1/admin/corrections/apply") return ok(res, withIdempotency(data, req, () => applyCorrection(data, { ...body, operatorId: adminOperatorId(adminPrincipal, body) })));
      if (route === "GET /api/v1/admin/audit-logs") return ok(res, listAuditLogs(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/external-status-mappings") return ok(res, withIdempotency(data, req, () => upsertExternalStatusMapping(data, body)));
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/tasks/") && url.pathname.endsWith("/complete")) {
        const taskId = url.pathname.split("/").at(-2);
        return ok(res, completeOperationTask(data, taskId, body));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/tasks/") && url.pathname.endsWith("/resolve")) {
        const taskId = url.pathname.split("/").at(-2);
        return ok(res, resolveManualReview(data, taskId, body));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/refunds/") && url.pathname.endsWith("/approve")) {
        const refundId = url.pathname.split("/").at(-2);
        return ok(res, approveRefund(data, refundId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/coupons/") && url.pathname.endsWith("/use")) {
        const couponId = url.pathname.split("/").at(-2);
        return ok(res, markCouponUsed(data, couponId));
      }

      send(res, 404, { code: 404, message: "接口不存在", data: null });
    } catch (error) {
      send(res, error.status || 200, {
        code: error.code || 500,
        message: error.message || "服务端错误",
        data: null,
      });
    }
  });

  server.store = data;
  server.storeAdapter = storeAdapter;
  return server;
}

module.exports = {
  createApp,
};
