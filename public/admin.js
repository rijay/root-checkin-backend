const labels = {
  users: "用户数",
  registered: "已注册",
  active: "打卡中",
  completed: "已完成",
  matchedOrders: "订单匹配",
  pendingRefunds: "待审核免单",
};

const summaryLabels = {
  activeSessions: "打卡中",
  dueToday: "今日应打卡",
  checkedToday: "今日已打卡",
  missedToday: "今日未打卡",
  day4Pending: "Day4 待问卷",
  day8Pending: "Day8 待问卷",
  refundPending: "待退款",
  couponUnused: "券待使用",
  openTasks: "Open 待办",
};

let currentData = null;
let currentTaskType = "";
let currentDetailUserId = "";
let currentSampleTemplates = [];
let currentTab = "today";
let selectedOrderId = "";
let selectedUserId = "";
let currentMatchPreview = null;
let currentUserKeyword = "";
let currentUserFilter = "";
let currentBulkOrderBatchId = "";
let currentFulfillmentBatchId = "";
let currentConflictFilter = "";
let currentBatchSourceFilter = "";
let currentAuditKeyword = "";
let currentAuditAction = "";

const ADMIN_TOKEN_KEY = "ROOT_ADMIN_TOKEN";

const sampleExamples = {
  YOUZAN_ORDER: [
    {
      有赞订单号: "YZROOT202605160001",
      收货人: "林小样",
      收货手机号: "13800001111",
      商品名称: "ROOT 7日试饮装",
      实付金额: "199",
      订单状态: "已支付",
      物流状态: "已发货",
      支付时间: "2026-05-16T10:00:00+08:00",
      收货地址: "上海市样例地址",
    },
  ],
  FULFILLMENT: [
    {
      有赞订单号: "YZROOT202605160001",
      快递公司: "SF",
      运单号: "SFROOT0516001",
      物流状态: "已签收",
      签收时间: "2026-05-18T11:20:00+08:00",
      最新物流节点: "本人签收",
    },
  ],
  WECHAT_LEAD: [
    {
      外部联系人ID: "wm_external_sample_001",
      企业微信备注名: "林小样-ROOT试饮",
      来源活动: "线下沙龙",
      当前添加状态: "ADDED",
      运营备注: "已发送入组规则",
      收货手机号: "13800001111",
    },
  ],
};

function getAdminToken() {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

function setAdminToken(token) {
  if (token) {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

function promptAdminToken() {
  const token = window.prompt("请输入后台访问口令");
  if (token === null) return "";
  setAdminToken(token.trim());
  return getAdminToken();
}

async function api(path, options = {}, retryAuth = true) {
  const adminToken = getAdminToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if ((response.status === 401 || payload.code === 40101) && retryAuth) {
    setAdminToken("");
    if (promptAdminToken()) return api(path, options, false);
  }
  if (payload.code !== 0) throw new Error(payload.message);
  return payload.data;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setHtml(selector, html) {
  const element = document.querySelector(selector);
  if (element) element.innerHTML = html;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") || "";
}

function maskPhone(phone) {
  const value = String(phone || "");
  return value.length >= 11 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
}

function parseDateParts(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateCn(dateText, referenceDate) {
  const parts = parseDateParts(dateText);
  if (!parts) return dateText ? String(dateText) : "";
  const reference = parseDateParts(referenceDate) || { year: new Date().getFullYear() };
  if (parts.year === reference.year) return `${parts.month}月${parts.day}日`;
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function dashboardReferenceDate() {
  return currentData && currentData.summary ? currentData.summary.date : undefined;
}

function setActiveTab(tabId) {
  currentTab = tabId || "today";
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === currentTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.dataset.panel === currentTab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderEmpty(text) {
  return `<div class="row empty-row"><div class="meta">${escapeHtml(text)}</div></div>`;
}

function renderMetrics(metrics) {
  setHtml("#metrics", Object.entries(labels)
    .map(([key, label]) => `<article class="metric"><strong>${metrics[key] || 0}</strong><span>${label}</span></article>`)
    .join(""));
}

function renderSummary(summary = {}) {
  setHtml("#summary", Object.entries(summaryLabels)
    .map(([key, label]) => `<article class="summary-item"><strong>${summary[key] || 0}</strong><span>${label}</span></article>`)
    .join("") + `<div class="summary-date">日期：${escapeHtml(summary.date ? formatDateCn(summary.date, summary.date) : "今日")} · 生成待办：${summary.generatedTasks || 0}</div>`);
}

function renderDailyOpsSummary(summary = {}) {
  const items = [
    ["今日订单导入", summary.importedOrders || 0],
    ["今日物流导入", summary.importedFulfillments || 0],
    ["今日送达", summary.deliveredToday || 0],
    ["今日自动匹配", summary.autoMatchedToday || 0],
    ["今日人工处理", summary.manualHandledToday || 0],
    ["未处理冲突", summary.openConflicts || 0],
    ["已送达待开始", summary.readyToStart || 0],
    ["导入批次", summary.importBatchCount || 0],
  ];
  setHtml("#daily-ops-summary", items.map(([label, value]) => `<article class="daily-ops-item"><span>${escapeHtml(label)}</span><strong>${value}</strong></article>`).join(""));
}

function renderOpsMetric(metric) {
  return `<article class="ops-metric">
    <span>${escapeHtml(metric.label)}</span>
    <strong>${metric.value || 0}</strong>
    <em>${escapeHtml(metric.description || "")}</em>
  </article>`;
}

function taskUserText(task) {
  const user = task.user || {};
  return firstValue(
    user.nickname && user.phone ? `${user.nickname} · ${user.phone}` : "",
    user.nickname,
    user.phone,
    task.user_id,
    "未知用户"
  );
}

function renderTaskRows(tasks = [], emptyText = "暂无运营待办。", compact = false) {
  if (!tasks.length) return renderEmpty(emptyText);
  return tasks
    .map((task) => {
      const id = task.taskId || task.task_id;
      const type = task.taskType || task.task_type;
      const script = task.suggestedScript || task.suggested_script || "您好，我来确认一下今天的记录情况。";
      const action = task.suggestedAction || task.suggested_action || "复制跟进话术，人工确认后标记状态";
      const priority = task.priorityLabel || task.label || task.priorityLevel || task.status || "待处理";
      return `<div class="row task-row ${compact ? "compact-row" : ""}">
        <div>
          <div class="title">${escapeHtml(task.label || type)} · ${escapeHtml(taskUserText(task))}</div>
          <div class="meta">${escapeHtml(task.reason || "待处理")}</div>
          ${compact ? "" : `<div class="meta">建议动作：${escapeHtml(action)}</div>`}
          ${compact ? "" : `<div class="script">话术：${escapeHtml(script)}</div>`}
        </div>
        <div class="task-actions">
          <span class="pill priority-${escapeHtml(String(task.priorityLevel || "").toLowerCase())}">${escapeHtml(priority)}</span>
          ${task.user ? `<button class="ghost" data-detail-user-id="${escapeHtml(task.user.userId || task.user.user_id)}">详情</button>` : ""}
          ${id ? `<button class="ghost" data-copy-script="${escapeHtml(script)}">复制话术</button>
          <button data-task-id="${escapeHtml(id)}" data-status="DONE" data-note="已人工联系">标记已联系</button>
          <button class="ghost" data-task-id="${escapeHtml(id)}" data-status="SKIPPED" data-note="暂不处理">跳过</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function renderOrderRows(orders = [], emptyText = "暂无待匹配订单。", options = {}) {
  if (!orders.length) return renderEmpty(emptyText);
  return orders
    .map((order) => `<div class="row compact-row ${selectedOrderId === order.orderId ? "selected-row" : ""}">
      <div>
        <div class="title">${escapeHtml(order.youzanOrderNo || order.youzan_order_no || order.orderId)}</div>
        <div class="meta">${escapeHtml(order.receiverName || order.receiver_name || "未知收货人")} · ${escapeHtml(order.receiverPhone || maskPhone(order.receiver_phone))}</div>
        <div class="meta">${escapeHtml(order.deliveryStatus || order.delivery_status || "-")} · ${escapeHtml(order.productName || order.product_name || "")}</div>
      </div>
      <div class="task-actions">
        <span class="pill">${order.userId ? "已绑定" : "待匹配"}</span>
        ${options.selectable && order.orderId ? `<button data-select-order-id="${escapeHtml(order.orderId)}">选择订单</button>` : ""}
      </div>
    </div>`)
    .join("");
}

function renderUserCandidateRows(users = [], emptyText = "暂无用户候选。") {
  if (!users.length) return renderEmpty(emptyText);
  return users
    .map((user) => `<div class="row compact-row ${selectedUserId === user.userId ? "selected-row" : ""}">
      <div>
        <div class="title">${escapeHtml(user.nickname || "ROOT用户")} · ${escapeHtml(user.phone || "")}</div>
        <div class="meta">${escapeHtml(user.state || "")} · 已匹配订单 ${user.matchedOrderCount || 0}</div>
        ${user.currentSession ? `<div class="meta">当前周期：${escapeHtml(user.currentSession.status)} · ${escapeHtml(formatDateCn(user.currentSession.startDate, dashboardReferenceDate()))}</div>` : ""}
      </div>
      <div class="task-actions">
        <button data-select-user-id="${escapeHtml(user.userId)}">选择用户</button>
        <button class="ghost" data-detail-user-id="${escapeHtml(user.userId)}">详情</button>
      </div>
    </div>`)
    .join("");
}

function renderRefundPreviewRows(refunds = []) {
  if (!refunds.length) return renderEmpty("暂无待审核免单。");
  return refunds
    .map((item) => `<div class="row compact-row">
      <div>
        <div class="title">${escapeHtml(item.youzanOrderNo || item.youzan_order_no || item.refundId || item.refund_id)}</div>
        <div class="meta">${escapeHtml(item.user ? `${item.user.nickname || "ROOT用户"} · ${item.user.phone || ""}` : "未知用户")} · 金额 ${item.amount || 0}</div>
      </div>
      <span class="pill">${escapeHtml(item.status || "PENDING")}</span>
    </div>`)
    .join("");
}

function renderFeedbackRows(feedbacks = [], emptyText = "暂无异常反馈。") {
  if (!feedbacks.length) return renderEmpty(emptyText);
  return feedbacks
    .map((item) => {
      const severity = item.severity || (item.tone === "danger" ? "高" : item.tone === "warning" ? "中" : "待看");
      return `<div class="row feedback-row">
        <div>
          <div class="title">${escapeHtml(item.title || "身体反馈")} · ${escapeHtml(item.user ? `${item.user.nickname || "ROOT用户"} · ${item.user.phone || ""}` : "未知用户")}</div>
          <p>${escapeHtml(item.text || "图片/便型反馈")}</p>
          <div class="meta">${escapeHtml(formatDateCn(item.date, dashboardReferenceDate()))} · ${escapeHtml(item.sourceType || "")}</div>
        </div>
        <div class="task-actions">
          <span class="pill priority-${escapeHtml(String(severity).toLowerCase())}">${escapeHtml(severity)}</span>
          ${item.user ? `<button class="ghost" data-detail-user-id="${escapeHtml(item.user.userId || item.user.user_id)}">详情</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function renderReadyRows(items = [], emptyText = "暂无已送达待开始用户。") {
  if (!items.length) return renderEmpty(emptyText);
  return items
    .map((item) => {
      const user = item.user || {};
      const order = item.order || {};
      return `<div class="row compact-row">
        <div>
          <div class="title">${escapeHtml(user.nickname || user.user_id || "ROOT用户")}</div>
          <div class="meta">${escapeHtml(order.youzanOrderNo || order.youzan_order_no || order.orderId)} · ${escapeHtml(order.deliveryStatus || order.delivery_status || "")}</div>
        </div>
        <div class="task-actions">
          <span class="pill">READY</span>
          ${user.userId || user.user_id ? `<button class="ghost" data-detail-user-id="${escapeHtml(user.userId || user.user_id)}">详情</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function renderOpsDashboard(ops = {}) {
  setHtml("#ops-metrics", (ops.metrics || []).map(renderOpsMetric).join(""));
  setHtml("#priority-tasks", renderTaskRows((ops.priorityTasks || []).slice(0, 10), "暂无高优先级待办。"));
  setHtml("#pending-orders-preview", renderOrderRows((ops.pendingOrders || []).slice(0, 4), "暂无待匹配订单。", { selectable: true }));
  setHtml("#pending-orders", renderOrderRows(ops.pendingOrders || [], "暂无待匹配订单。", { selectable: true }));
  setHtml("#refund-preview", renderRefundPreviewRows((ops.refundPreview || []).slice(0, 4)));
  setHtml("#risk-feedback-preview", renderFeedbackRows((ops.riskFeedbacks || []).slice(0, 4), "暂无异常反馈。"));
  setHtml("#risk-feedbacks", renderFeedbackRows(ops.riskFeedbacks || [], "暂无异常反馈。"));
  setHtml("#ready-users-preview", renderReadyRows((ops.readyToStartUsers || []).slice(0, 4)));
}

function selectedOrder() {
  const orders = [
    ...(currentData && currentData.orders ? currentData.orders : []),
    ...(currentData && currentData.opsDashboard ? currentData.opsDashboard.pendingOrders || [] : []),
  ];
  return orders.find((order) => order.orderId === selectedOrderId) || null;
}

function selectedUser() {
  const users = currentData && currentData.users ? currentData.users : [];
  return users.find((user) => user.userId === selectedUserId) || null;
}

function renderMatchPreview(preview = null) {
  currentMatchPreview = preview;
  const order = preview ? preview.order : selectedOrder();
  const user = preview ? preview.user : selectedUser();
  if (!order || !user) {
    setHtml("#match-preview", `<div class="empty-box">已选择：${order ? "订单" : "未选订单"} / ${user ? "用户" : "未选用户"}。选择两侧候选后生成预览。</div>`);
    return;
  }
  const risks = preview.risks || [];
  const riskHtml = risks.length
    ? risks.map((item) => `<div class="risk-row risk-${escapeHtml(String(item.level || "").toLowerCase())}">
        <strong>${escapeHtml(item.type)}</strong>
        <span>${escapeHtml(item.message)}</span>
      </div>`).join("")
    : `<div class="risk-row risk-safe"><strong>无明显风险</strong><span>可直接确认匹配。</span></div>`;
  const effects = (preview.writeEffects || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  setHtml("#match-preview", `
    <div class="match-card">
      <h4>订单</h4>
      <p>${escapeHtml(order.youzanOrderNo)} · ${escapeHtml(order.receiverName || "未知收货人")} · ${escapeHtml(order.deliveryStatus)}</p>
    </div>
    <div class="match-card">
      <h4>用户</h4>
      <p>${escapeHtml(user.nickname || "ROOT用户")} · ${escapeHtml(user.phone || "")} · ${escapeHtml(user.state || "")}</p>
    </div>
    <div class="match-card">
      <h4>风险提示</h4>
      ${riskHtml}
    </div>
    <div class="match-card">
      <h4>写入影响</h4>
      <ul>${effects}</ul>
      <p class="meta">${escapeHtml(preview.recommendedAction || "")}</p>
    </div>
  `);
  const riskInput = document.querySelector("#confirm-risks");
  const rebindInput = document.querySelector("#confirm-rebind");
  if (riskInput) riskInput.checked = !preview.requiresSecondConfirm;
  if (rebindInput) rebindInput.checked = false;
}

async function previewSelectedMatch() {
  if (!selectedOrderId || !selectedUserId) {
    renderMatchPreview(null);
    return;
  }
  try {
    const preview = await api("/api/v1/admin/order-matching/preview", {
      method: "POST",
      body: JSON.stringify({ orderId: selectedOrderId, userId: selectedUserId }),
    });
    renderMatchPreview(preview);
  } catch (error) {
    currentMatchPreview = null;
    setHtml("#match-preview", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function searchOrderMatching() {
  try {
    const query = document.querySelector("#order-match-search").value.trim();
    const result = await api(`/api/v1/admin/order-matching/search?q=${encodeURIComponent(query)}`);
    setHtml("#pending-orders", renderOrderRows(result.orders || [], "暂无订单候选。", { selectable: true }));
    setHtml("#user-candidates", renderUserCandidateRows(result.users || [], "暂无用户候选。"));
    setHtml("#match-result", `<div class="inline-success">已找到订单 ${result.orders.length} 条，用户 ${result.users.length} 个。</div>`);
  } catch (error) {
    setHtml("#match-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

function readManualOrderForm() {
  return {
    youzanOrderNo: document.querySelector("#manual-order-no").value.trim(),
    receiverPhone: document.querySelector("#manual-order-phone").value.trim(),
    receiverName: document.querySelector("#manual-order-name").value.trim(),
    productName: document.querySelector("#manual-order-product").value.trim() || "ROOT 7日试饮装",
    amount: document.querySelector("#manual-order-amount").value || 0,
    orderStatus: document.querySelector("#manual-order-status").value,
    deliveryStatus: document.querySelector("#manual-delivery-status").value,
    rawAddressText: document.querySelector("#manual-order-address").value.trim(),
  };
}

async function syncManualOrderFromForm() {
  try {
    const data = await api("/api/v1/admin/orders/sync", {
      method: "POST",
      body: JSON.stringify(readManualOrderForm()),
    });
    selectedOrderId = data.order.orderId;
    setHtml("#order-sync-result", `<div class="inline-success">已录入订单 ${escapeHtml(data.order.youzanOrderNo)}，可继续选择用户匹配。</div>`);
    await load();
    await previewSelectedMatch();
  } catch (error) {
    setHtml("#order-sync-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

function bulkOrderTemplate() {
  const template = sampleTemplateForSource("YOUZAN_ORDER");
  return template
    ? template.csvHeader
    : "有赞订单号,收货人,收货手机号,商品名称,商品ID,实付金额,订单状态,物流状态,支付时间,收货地址";
}

function fulfillmentTemplate() {
  const template = sampleTemplateForSource("FULFILLMENT");
  return template
    ? template.csvHeader
    : "快递公司,获取时间,电子面单号,订单号,运输状态,收件人姓名,收件人联系方式";
}

function readBulkOrderPayload() {
  const text = document.querySelector("#bulk-order-input").value.trim();
  if (!text) throw new Error("请先粘贴有赞订单表格内容");
  return { sourceType: "YOUZAN_ORDER", text };
}

function readFulfillmentPayload() {
  const text = document.querySelector("#fulfillment-input").value.trim();
  if (!text) throw new Error("请先粘贴物流状态表格内容");
  return { sourceType: "FULFILLMENT", text };
}

function renderBulkOrderResult(result = {}, mode = "preview", selector = "#bulk-order-result") {
  const importResult = result.preview || result.result || result;
  const rows = importResult.rows || [];
  const batchLine = result.batchId
    ? `<div class="meta">导入批次：${escapeHtml(result.batchId)} · hash ${escapeHtml(String(result.contentHash || "").slice(0, 12))}</div>`
    : "";
  const summary = `<div class="bulk-summary">
    <span>总行数 ${importResult.total || 0}</span>
    <span>可写入 ${importResult.importableCount || 0}</span>
    <span>已写入 ${importResult.importedCount || 0}</span>
    <span>错误 ${importResult.errorCount || 0}</span>
    <span>提醒 ${importResult.warningCount || 0}</span>
  </div>`;
  const rowsHtml = rows.length
    ? rows.map((row) => {
        const mapped = row.mapped || {};
        const orderText = mapped.youzanOrderNo || mapped.orderId || "无订单号";
        const personText = firstValue(mapped.receiverName, mapped.carrier, mapped.lastEventText, "无姓名/节点");
        const phoneOrTrackingText = firstValue(maskPhone(mapped.receiverPhone || ""), mapped.trackingNo, "-");
        const statusText = mapped.deliveryStatus || mapped.orderStatus || "-";
        const label = row.errors && row.errors.length
          ? "不可写入"
          : mode === "import" && row.imported
            ? "已写入"
            : row.warnings && row.warnings.length
              ? "可写入，有提醒"
              : "可写入";
        const messages = [
          ...((row.errors || []).map((item) => `错误：${item}`)),
          ...((row.warnings || []).map((item) => `提醒：${item}`)),
        ];
        return `<div class="bulk-row">
          <div class="bulk-row-head">
            <strong>#${row.index} · ${escapeHtml(label)}</strong>
            <span>${escapeHtml(statusText)}</span>
          </div>
          <div class="meta">${escapeHtml(orderText)} · ${escapeHtml(personText)} · ${escapeHtml(phoneOrTrackingText)}</div>
          ${messages.length ? `<div class="${row.errors && row.errors.length ? "sample-error" : "sample-warning"}">${escapeHtml(messages.join("；"))}</div>` : ""}
        </div>`;
      }).join("")
    : `<div class="meta">暂无数据行。</div>`;
  setHtml(selector, batchLine + summary + rowsHtml);
}

function toggleBulkOrderPanel() {
  const panel = document.querySelector("#bulk-order-panel");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden && !document.querySelector("#bulk-order-input").value.trim()) {
    document.querySelector("#bulk-order-input").placeholder = `${bulkOrderTemplate()}\nYZROOT202605240001,王小路,13800000001,ROOT 7日试饮装,ROOT-PREBIOTIC-TRIAL,199,已支付,已签收,2026-05-24T10:00:00+08:00,上海市样例地址`;
  }
}

function insertBulkOrderTemplate() {
  document.querySelector("#bulk-order-input").value = bulkOrderTemplate();
  currentBulkOrderBatchId = "";
  const fileInput = document.querySelector("#bulk-order-file");
  if (fileInput) fileInput.value = "";
  setHtml("#bulk-file-status", `<span class="meta">已填入后台模板表头；也可直接上传有赞原始 CSV。</span>`);
  setHtml("#bulk-order-result", `<div class="meta">已填入表头，请从有赞订单表复制真实行后再预览。</div>`);
}

function insertFulfillmentTemplate() {
  document.querySelector("#fulfillment-input").value = fulfillmentTemplate();
  currentFulfillmentBatchId = "";
  const fileInput = document.querySelector("#fulfillment-file");
  if (fileInput) fileInput.value = "";
  setHtml("#fulfillment-file-status", `<span class="meta">已填入物流模板表头；也可直接上传物流状态原始 CSV。</span>`);
  setHtml("#fulfillment-result", `<div class="meta">已填入表头，请从物流状态表复制真实行后再预览。</div>`);
}

function readTextFile(file) {
  if (file && typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(new Error("CSV 文件读取失败，请重新选择文件"));
    reader.readAsText(file, "utf-8");
  });
}

async function loadBulkOrderCsvFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readTextFile(file);
    if (!text.trim()) throw new Error("CSV 文件内容为空");
    document.querySelector("#bulk-order-input").value = text;
    currentBulkOrderBatchId = "";
    const rowCount = Math.max(0, text.split(/\r?\n/).filter((line) => line.trim()).length - 1);
    setHtml("#bulk-file-status", `<span class="meta">已读取 ${escapeHtml(file.name)}，共 ${rowCount} 行订单，正在预览校验。</span>`);
    await previewBulkOrders();
  } catch (error) {
    setHtml("#bulk-file-status", `<span class="sample-error">${escapeHtml(error.message)}</span>`);
    setHtml("#bulk-order-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function loadFulfillmentCsvFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readTextFile(file);
    if (!text.trim()) throw new Error("CSV 文件内容为空");
    document.querySelector("#fulfillment-input").value = text;
    currentFulfillmentBatchId = "";
    const rowCount = Math.max(0, text.split(/\r?\n/).filter((line) => line.trim()).length - 1);
    setHtml("#fulfillment-file-status", `<span class="meta">已读取 ${escapeHtml(file.name)}，共 ${rowCount} 行物流，正在预览校验。</span>`);
    await previewFulfillment();
  } catch (error) {
    setHtml("#fulfillment-file-status", `<span class="sample-error">${escapeHtml(error.message)}</span>`);
    setHtml("#fulfillment-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function previewBulkOrders() {
  try {
    const result = await api("/api/v1/admin/imports/preview", {
      method: "POST",
      body: JSON.stringify(readBulkOrderPayload()),
    });
    currentBulkOrderBatchId = result.batchId || "";
    renderBulkOrderResult(result, "preview");
  } catch (error) {
    setHtml("#bulk-order-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function previewFulfillment() {
  try {
    const result = await api("/api/v1/admin/imports/preview", {
      method: "POST",
      body: JSON.stringify(readFulfillmentPayload()),
    });
    currentFulfillmentBatchId = result.batchId || "";
    renderBulkOrderResult(result, "preview", "#fulfillment-result");
  } catch (error) {
    setHtml("#fulfillment-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function importBulkOrders() {
  try {
    if (!currentBulkOrderBatchId) await previewBulkOrders();
    if (!currentBulkOrderBatchId) throw new Error("请先预览订单导入批次");
    const result = await api(`/api/v1/admin/imports/${encodeURIComponent(currentBulkOrderBatchId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    renderBulkOrderResult(result, "import");
    await load();
    const importedCount = result.result ? result.result.importedCount || 0 : 0;
    setHtml("#match-result", `<div class="inline-success">已写入 ${importedCount} 条订单，可在左侧待匹配列表继续选择用户。</div>`);
  } catch (error) {
    setHtml("#bulk-order-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function importFulfillment() {
  try {
    if (!currentFulfillmentBatchId) await previewFulfillment();
    if (!currentFulfillmentBatchId) throw new Error("请先预览物流导入批次");
    const result = await api(`/api/v1/admin/imports/${encodeURIComponent(currentFulfillmentBatchId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    renderBulkOrderResult(result, "import", "#fulfillment-result");
    await load();
    const importedCount = result.result ? result.result.importedCount || 0 : 0;
    setHtml("#match-result", `<div class="inline-success">已写入 ${importedCount} 条物流状态，并刷新用户物流/打卡启动状态。</div>`);
  } catch (error) {
    setHtml("#fulfillment-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function confirmSelectedMatch() {
  if (!selectedOrderId || !selectedUserId) {
    setHtml("#match-result", `<div class="sample-error">请先选择订单和用户。</div>`);
    return;
  }
  const confirmRisks = Boolean(document.querySelector("#confirm-risks").checked);
  const confirmRebind = Boolean(document.querySelector("#confirm-rebind").checked);
  const note = document.querySelector("#match-note").value.trim();
  try {
    const result = await api("/api/v1/admin/order-matching/confirm", {
      method: "POST",
      body: JSON.stringify({ orderId: selectedOrderId, userId: selectedUserId, confirmRisks, confirmRebind, note }),
    });
    setHtml("#match-result", `<div class="inline-success">匹配成功：${escapeHtml(result.order.youzanOrderNo)} 已绑定给 ${escapeHtml(result.user.nickname)}。</div>`);
    currentMatchPreview = null;
    await load();
  } catch (error) {
    setHtml("#match-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function ignoreMatchConflict(taskId) {
  const reason = window.prompt("请输入忽略冲突的原因", "运营已人工确认，本次无需继续提醒");
  if (reason === null) return;
  try {
    await api("/api/v1/admin/corrections/apply", {
      method: "POST",
      body: JSON.stringify({ action: "IGNORE_CONFLICT", taskId, reason: reason.trim() }),
    });
    setHtml("#match-result", `<div class="inline-success">已忽略该匹配冲突，并写入审计记录。</div>`);
    await load();
  } catch (error) {
    setHtml("#match-result", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

function clearOrderMatchingSelection() {
  selectedOrderId = "";
  selectedUserId = "";
  currentMatchPreview = null;
  setHtml("#match-result", "");
  setHtml("#order-sync-result", "");
  renderOpsDashboard(currentData ? currentData.opsDashboard || {} : {});
  setHtml("#user-candidates", renderUserCandidateRows(currentData ? currentData.users || [] : [], "暂无用户候选。"));
  renderMatchPreview(null);
}

function readinessStatusText(status) {
  const labels = {
    READY: "READY",
    NEEDS_REVIEW: "NEEDS_REVIEW",
    BLOCKED: "BLOCKED",
    PASS: "PASS",
    WARNING: "WARNING",
    BLOCKER: "BLOCKER",
  };
  return labels[status] || status || "-";
}

function renderLaunchReadiness(readiness = {}) {
  const summary = readiness.summary || {};
  const checks = readiness.checks || [];
  const checkRows = checks.length
    ? checks.map((check) => `<div class="readiness-check">
        <div>
          <strong>${escapeHtml(check.label)}</strong>
          <span>${escapeHtml(check.message)}</span>
        </div>
        <span class="pill readiness-${escapeHtml(check.status || "").toLowerCase()}">${escapeHtml(readinessStatusText(check.status))}</span>
      </div>`).join("")
    : `<div class="meta">暂无上线检查结果。</div>`;
  document.querySelector("#launch-readiness").innerHTML = `
    <div class="readiness-summary">
      <span class="pill readiness-${escapeHtml(readiness.status || "").toLowerCase()}">${escapeHtml(readinessStatusText(readiness.status))}</span>
      <span>阻塞 ${summary.blockers || 0}</span>
      <span>提醒 ${summary.warnings || 0}</span>
      <span>通过 ${summary.passed || 0}/${summary.total || 0}</span>
    </div>
    ${checkRows}`;
}

function renderAdapterCalibration(calibration = {}) {
  const summary = calibration.summary || {};
  const sources = calibration.sources || [];
  const sourceRows = sources.length
    ? sources.map((source) => {
        const checks = (source.checks || []).map((check) => `<div class="mini-check">
          <span class="pill readiness-${escapeHtml(check.status || "").toLowerCase()}">${escapeHtml(check.status || "-")}</span>
          <div>
            <strong>${escapeHtml(check.label)}</strong>
            <span>${escapeHtml(check.message)}</span>
          </div>
        </div>`).join("");
        const missing = [
          ...(source.env && source.env.required ? source.env.required.filter((item) => !item.present).map((item) => item.name) : []),
          ...(source.env && source.env.anyOf ? source.env.anyOf.filter((group) => !group.present).map((group) => group.names.join(" / ")) : []),
        ];
        return `<div class="calibration-source">
          <div class="sample-review-head">
            <strong>${escapeHtml(source.label)} · ${escapeHtml(source.adapterKind)}</strong>
            <span class="pill readiness-${escapeHtml(source.status || "").toLowerCase()}">${escapeHtml(readinessStatusText(source.status))}</span>
          </div>
          <div class="meta">${missing.length ? `缺少：${escapeHtml(missing.join("；"))}` : "必要配置已齐"}</div>
          <div class="calibration-checks">${checks}</div>
          <div class="script">${escapeHtml(source.rollback || "")}</div>
        </div>`;
      }).join("")
    : `<div class="meta">暂无校准结果。</div>`;
  document.querySelector("#adapter-calibration").innerHTML = `
    <div class="readiness-summary">
      <span class="pill readiness-${escapeHtml(calibration.status || "").toLowerCase()}">${escapeHtml(readinessStatusText(calibration.status))}</span>
      <span>阻塞 ${summary.blockers || 0}</span>
      <span>提醒 ${summary.warnings || 0}</span>
      <span>通过 ${summary.passed || 0}/${summary.total || 0}</span>
    </div>
    ${sourceRows}`;
}

function renderReleaseRecord(record = {}) {
  const evidence = record.evidence || {};
  const checklist = record.checklist || {};
  const runs = evidence.recentAdapterRuns || [];
  const blockerRows = (checklist.mustFixBeforeRelease || []).slice(0, 6)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const warningRows = (checklist.mustConfirmForGray || []).slice(0, 6)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const signoffs = (record.signoffs || []).map((item) => `<div class="release-signoff">
      <strong>${escapeHtml(item.role)}</strong>
      <span>${escapeHtml(item.status)} · ${escapeHtml(item.note)}</span>
    </div>`).join("");
  const runRows = runs.length
    ? runs.map((run) => `<div class="mini-row">
        <strong>${escapeHtml(run.adapterKind)} · ${escapeHtml(run.status)}</strong>
        <span>${escapeHtml(run.mode)} · 导入 ${run.importedCount || 0} · ${escapeHtml(run.finishedAt || "未完成")}</span>
      </div>`).join("")
    : `<div class="meta">暂无真实 Adapter 运行记录。</div>`;
  document.querySelector("#release-record").innerHTML = `
    <div class="release-decision">
      <span class="pill readiness-${escapeHtml(record.status || "").toLowerCase()}">${escapeHtml(readinessStatusText(record.status))}</span>
      <strong>${escapeHtml(record.decision ? record.decision.recommendation : "")}</strong>
      <span>${escapeHtml(record.target || "production")} · ${escapeHtml(record.generatedAt || "")}</span>
    </div>
    <div class="release-grid">
      <section>
        <h3>阻塞项</h3>
        ${blockerRows ? `<ul>${blockerRows}</ul>` : `<div class="meta">暂无阻塞项。</div>`}
      </section>
      <section>
        <h3>灰度确认</h3>
        ${warningRows ? `<ul>${warningRows}</ul>` : `<div class="meta">暂无提醒项。</div>`}
      </section>
      <section>
        <h3>签字位</h3>
        ${signoffs || `<div class="meta">暂无签字位。</div>`}
      </section>
      <section>
        <h3>最近运行</h3>
        ${runRows}
      </section>
    </div>`;
}

function normalizeUserRow(user, sessions = []) {
  const session = sessions.find((item) => item.userId === user.userId);
  return {
    ...user,
    stateLabel: user.stateLabel || user.state || "",
    currentStatus: user.currentStatus || (session ? session.status : "暂无周期"),
    currentBlockage: user.currentBlockage || "暂无明显卡点",
    nextAction: user.nextAction || "保持观察",
    orderStatusLabel: user.orderStatusLabel || "暂无订单",
    latestOrderNo: user.latestOrderNo || "",
    latestCheckinDate: user.latestCheckinDate || user.lastCheckinDate || "",
    totalRecords: user.totalRecords === undefined ? user.totalCheckinDays || 0 : user.totalRecords,
    openTaskCount: user.openTaskCount || 0,
    severity: user.severity || "LOW",
  };
}

function userMatchesCurrentFilter(user) {
  if (!currentUserFilter) return true;
  if (currentUserFilter === "needs_action") return user.openTaskCount > 0 || ["HIGH", "MEDIUM"].includes(user.severity);
  if (currentUserFilter === "ready_to_start") return user.currentBlockage === "已送达未开始";
  if (currentUserFilter === "waiting_delivery") return user.currentBlockage === "等待物流送达";
  if (currentUserFilter === "active") return user.currentStatus === "打卡中" || user.state === "CHECKIN_ACTIVE";
  if (currentUserFilter === "completed") return user.currentStatus === "已完成" || user.state === "CHECKIN_COMPLETED";
  return true;
}

function userMatchesKeyword(user) {
  if (!currentUserKeyword) return true;
  const text = [
    user.nickname,
    user.phone,
    user.stateLabel,
    user.currentStatus,
    user.currentBlockage,
    user.nextAction,
    user.latestOrderNo,
    user.orderStatusLabel,
  ].join(" ").toLowerCase();
  return text.includes(currentUserKeyword.toLowerCase());
}

function renderUsers(users = [], sessions = []) {
  const normalized = users.map((user) => normalizeUserRow(user, sessions));
  const visible = normalized.filter((user) => userMatchesCurrentFilter(user) && userMatchesKeyword(user));
  setHtml("#users", visible.length
    ? visible
        .map((user) => `
          <div class="row user-row">
            <div>
              <div class="title">${escapeHtml(user.nickname)} · ${escapeHtml(user.phone)}</div>
              <div class="meta">状态：${escapeHtml(user.stateLabel)} · ${escapeHtml(user.currentStatus)} · 待办 ${user.openTaskCount || 0}</div>
              <div class="meta">卡点：${escapeHtml(user.currentBlockage)} · 下一步：${escapeHtml(user.nextAction)}</div>
              <div class="meta">订单：${escapeHtml(user.latestOrderNo || "暂无")} · ${escapeHtml(user.orderStatusLabel)} · 记录 ${user.totalRecords || 0} 次${user.latestCheckinDate ? ` · 最近 ${escapeHtml(formatDateCn(user.latestCheckinDate, dashboardReferenceDate()))}` : ""}</div>
            </div>
            <div class="task-actions">
              <span class="pill priority-${escapeHtml(String(user.severity || "").toLowerCase())}">${escapeHtml(user.currentBlockage)}</span>
              <button class="ghost" data-detail-user-id="${escapeHtml(user.userId)}">详情</button>
            </div>
          </div>`)
        .join("")
    : `<div class="row"><div class="meta">暂无匹配用户。</div></div>`);
}

function renderRefunds(refunds = []) {
  setHtml("#refunds", refunds.length
    ? refunds
        .map((refund) => {
          const id = refund.refund_work_item_id || refund.refund_id;
          return `<div class="row">
          <div>
            <div class="title">${escapeHtml(refund.youzan_order_no || refund.refund_id)}</div>
            <div class="meta">金额：${refund.amount} · 状态：${escapeHtml(refund.status)}</div>
          </div>
          ${refund.status === "PENDING" ? `<button data-id="${escapeHtml(id)}">通过</button>` : `<span class="pill">${escapeHtml(refund.status)}</span>`}
        </div>`;
        })
        .join("")
    : `<div class="row"><div class="meta">暂无免单申请。</div></div>`);
}

function renderTaskFilter(tasks) {
  const select = document.querySelector("#task-filter");
  if (!select) return;
  const types = [...new Set(tasks.map((task) => task.taskType || task.task_type).filter(Boolean))].sort();
  select.innerHTML = `<option value="">全部类型</option>` + types
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join("");
  select.value = types.includes(currentTaskType) ? currentTaskType : "";
  currentTaskType = select.value;
}

function renderTasks(tasks) {
  if (!document.querySelector("#tasks")) return;
  const visibleTasks = currentTaskType
    ? tasks.filter((task) => (task.taskType || task.task_type) === currentTaskType)
    : tasks;
  document.querySelector("#tasks").innerHTML = visibleTasks.length
    ? visibleTasks
        .map((task) => {
          const id = task.taskId || task.task_id;
          const type = task.taskType || task.task_type;
          const user = task.user ? `${task.user.nickname} · ${task.user.phone}` : (task.user_id || "未知用户");
          return `<div class="row task-row">
            <div>
              <div class="title">${escapeHtml(task.label || type)} · ${escapeHtml(user)}</div>
              <div class="meta">${escapeHtml(task.reason || "待处理")}</div>
              <div class="meta">动作：${escapeHtml(task.suggestedAction || task.suggested_action || "复制跟进话术，人工确认后标记状态")}</div>
	            <div class="script">话术：${escapeHtml(task.suggestedScript || task.suggested_script || "您好，我来确认一下今天的打卡情况。")}</div>
	          </div>
	          <div class="task-actions">
	            <span class="pill">${escapeHtml(task.status)}</span>
	            ${task.user ? `<button class="ghost" data-detail-user-id="${escapeHtml(task.user.userId)}">详情</button>` : ""}
	            <button data-task-id="${escapeHtml(id)}" data-status="DONE">完成</button>
	            <button class="ghost" data-task-id="${escapeHtml(id)}" data-status="SKIPPED">跳过</button>
	          </div>
	        </div>`;
        })
        .join("")
    : `<div class="row"><div class="meta">暂无运营待办。</div></div>`;
}

function renderMatchConflicts(tasks = []) {
  const container = document.querySelector("#match-conflicts");
  if (!container) return;
  const conflicts = tasks
    .filter((task) => (task.taskType || task.task_type) === "ORDER_PHONE_MATCH_CONFLICT")
    .filter((task) => {
      const metadata = task.metadata || {};
      if (currentConflictFilter === "multi-order") return Boolean((metadata.candidateOrderIds || metadata.otherOrderIds || []).length);
      if (currentConflictFilter === "multi-user") return Boolean((metadata.candidateUserIds || []).length);
      return true;
    });
  if (!conflicts.length) {
    container.innerHTML = currentData && (currentData.operationTasks || []).some((task) => (task.taskType || task.task_type) === "ORDER_PHONE_MATCH_CONFLICT")
      ? `<section class="conflict-panel"><div class="meta">当前筛选下暂无冲突。</div></section>`
      : "";
    return;
  }
  const orderById = new Map((currentData ? currentData.orders || [] : []).map((order) => [order.orderId, order]));
  container.innerHTML = `<section class="conflict-panel">
    <div>
      <h3>手机号匹配冲突</h3>
      <p>同一个授权手机号命中多用户或多订单，需要运营核对后再手动匹配。</p>
    </div>
    ${conflicts.map((task) => {
      const metadata = task.metadata || {};
      const order = task.order || orderById.get(task.order_id) || {};
      const relatedOrderIds = metadata.candidateOrderIds || metadata.otherOrderIds || [];
      const relatedOrders = relatedOrderIds
        .map((orderId) => orderById.get(orderId))
        .filter(Boolean)
        .map((item) => item.youzanOrderNo)
        .join("、");
      const candidates = (metadata.candidateUserIds || (metadata.userId ? [metadata.userId] : [])).join("、");
      return `<div class="conflict-row">
        <div>
          <strong>${escapeHtml(order.youzanOrderNo || task.order_id || "未知订单")}</strong>
          <span>${escapeHtml(task.reason || "手机号匹配冲突")}</span>
          <em>${escapeHtml([
            metadata.phone ? `手机号 ${maskPhone(metadata.phone)}` : "",
            candidates ? `候选用户 ${candidates}` : "",
            relatedOrders ? `相关订单 ${relatedOrders}` : "",
          ].filter(Boolean).join(" · "))}</em>
        </div>
        <div class="task-actions">
          ${order.orderId ? `<button data-select-order-id="${escapeHtml(order.orderId)}">去匹配</button>` : ""}
          <button class="ghost" data-ignore-conflict-task-id="${escapeHtml(task.taskId || task.task_id)}">忽略</button>
        </div>
      </div>`;
    }).join("")}
  </section>`;
}

function sourceTypeLabel(sourceType) {
  return {
    YOUZAN_ORDER: "有赞订单",
    FULFILLMENT: "物流状态",
    WECHAT_LEAD: "企业微信线索",
  }[sourceType] || sourceType || "-";
}

function importResultSummary(batch = {}) {
  const result = batch.result || batch.preview || {};
  return {
    total: result.total || 0,
    imported: result.importedCount || 0,
    importable: result.importableCount || 0,
    errors: result.errorCount || 0,
    warnings: result.warningCount || 0,
  };
}

function batchMatchesFilter(batch) {
  return !currentBatchSourceFilter || batch.sourceType === currentBatchSourceFilter;
}

function renderImportBatches(batches = []) {
  const visible = batches.filter(batchMatchesFilter);
  setHtml("#import-batches", visible.length ? visible.map((batch) => {
    const summary = importResultSummary(batch);
    const file = batch.fileSummary || {};
    return `<div class="ledger-row">
      <div>
        <strong>${escapeHtml(sourceTypeLabel(batch.sourceType))} · ${escapeHtml(batch.status)}</strong>
        <div class="meta">${escapeHtml(file.fileName || "未命名文件")} · ${escapeHtml(formatDateCn((batch.updatedAt || batch.createdAt || "").slice(0, 10), dashboardReferenceDate()))} · hash ${escapeHtml(String(batch.contentHash || "").slice(0, 12))}</div>
        <div class="meta">总 ${summary.total} · 可写 ${summary.importable} · 已写 ${summary.imported} · 错误 ${summary.errors} · 提醒 ${summary.warnings}</div>
      </div>
      <div class="task-actions">
        <button class="ghost" data-batch-detail-id="${escapeHtml(batch.batchId)}">详情</button>
        ${summary.errors ? `<button data-batch-export-id="${escapeHtml(batch.batchId)}">导出失败</button>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="meta">暂无导入批次。</div>`);
}

async function loadImportBatchDetail(batchId) {
  try {
    const batch = await api(`/api/v1/admin/imports/${encodeURIComponent(batchId)}`);
    const summary = importResultSummary(batch);
    const rows = ((batch.result || batch.preview || {}).rows || []).slice(0, 8);
    setHtml("#import-batch-detail", `
      <div class="ledger-row">
        <div>
          <strong>${escapeHtml(sourceTypeLabel(batch.sourceType))} · ${escapeHtml(batch.batchId)}</strong>
          <div class="meta">状态 ${escapeHtml(batch.status)} · 总 ${summary.total} · 已写 ${summary.imported} · 错误 ${summary.errors} · 提醒 ${summary.warnings}</div>
          <div class="meta">文件：${escapeHtml((batch.fileSummary || {}).fileName || "未命名")} · 内容 hash ${escapeHtml(batch.contentHash || "")}</div>
        </div>
        <div class="task-actions">${summary.errors ? `<button data-batch-export-id="${escapeHtml(batch.batchId)}">导出失败</button>` : ""}</div>
      </div>
      ${rows.map((row) => `<div class="bulk-row">
        <div class="bulk-row-head">
          <strong>#${row.index} · ${row.errors && row.errors.length ? "失败" : row.imported ? "已写入" : "预览"}</strong>
          <span>${escapeHtml((row.errors || row.warnings || []).join("；") || "OK")}</span>
        </div>
        <div class="meta">${escapeHtml(JSON.stringify(row.mapped || {}))}</div>
      </div>`).join("")}
    `);
  } catch (error) {
    setHtml("#import-batch-detail", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

async function exportBatchFailures(batchId) {
  try {
    const adminToken = getAdminToken();
    const response = await fetch(`/api/v1/admin/imports/${encodeURIComponent(batchId)}/failures.csv`, {
      headers: adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {},
    });
    if (!response.ok) throw new Error("导出失败，请检查后台口令");
    const text = await response.text();
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${batchId}-failures.csv`;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  } catch (error) {
    setHtml("#import-batch-detail", `<div class="sample-error">${escapeHtml(error.message)}</div>`);
  }
}

function auditMatchesFilters(log) {
  if (currentAuditAction && log.action !== currentAuditAction) return false;
  if (!currentAuditKeyword) return true;
  const text = [
    log.action,
    log.target_type,
    log.target_id,
    log.operator_id,
    log.reason,
    JSON.stringify(log.before || {}),
    JSON.stringify(log.after || {}),
  ].join(" ").toLowerCase();
  return text.includes(currentAuditKeyword.toLowerCase());
}

function renderAuditLogs(logs = []) {
  const visible = logs.filter(auditMatchesFilters);
  setHtml("#audit-logs", visible.length ? visible.map((log) => `<div class="audit-row">
    <div>
      <strong>${escapeHtml(log.action)} · ${escapeHtml(log.target_type || "-")}</strong>
      <div class="meta">${escapeHtml(log.target_id || "-")} · ${escapeHtml(log.operator_id || "unknown")} · ${escapeHtml(formatDateCn(String(log.created_at || "").slice(0, 10), dashboardReferenceDate()))}</div>
      <div class="meta">原因：${escapeHtml(log.reason || "未填写")}</div>
    </div>
    <span class="pill">${escapeHtml(log.audit_log_id || "")}</span>
  </div>`).join("") : `<div class="meta">暂无审计记录。</div>`);
}

function renderReadyUsers(items) {
  setHtml("#ready-users", items.length
    ? items
        .map((item) => `<div class="row">
          <div>
	            <div class="title">${escapeHtml(item.user ? item.user.nickname || item.user.user_id : "未知用户")}</div>
	            <div class="meta">${escapeHtml(item.order.youzanOrderNo)} · ${escapeHtml(item.order.deliveryStatus)}</div>
	          </div>
	          <div class="task-actions">
	            <span class="pill">READY</span>
	            ${item.user ? `<button class="ghost" data-detail-user-id="${escapeHtml(item.user.user_id)}">详情</button>` : ""}
	          </div>
	        </div>`)
        .join("")
    : `<div class="row"><div class="meta">暂无已送达待开始用户。</div></div>`);
}

function renderCoupons(summary = {}, coupons = []) {
  const treatment = summary.byGroup && summary.byGroup.DAY6_COUPON ? summary.byGroup.DAY6_COUPON : {};
  const control = summary.byGroup && summary.byGroup.CONTROL ? summary.byGroup.CONTROL : {};
  const metricHtml = `<div class="coupon-metrics">
    <div><strong>${treatment.issued || 0}</strong><span>发券</span></div>
    <div><strong>${treatment.claimRate || 0}%</strong><span>领取率</span></div>
    <div><strong>${treatment.useRate || 0}%</strong><span>使用率</span></div>
    <div><strong>${control.users || 0}</strong><span>对照组</span></div>
  </div>`;
  const rows = coupons.length
    ? coupons.map((item) => `<div class="row">
        <div>
          <div class="title">${escapeHtml(item.title || item.couponType)} · ${escapeHtml(item.user ? item.user.nickname : "未知用户")}</div>
          <div class="meta">${escapeHtml(item.experimentGroup)} · ${escapeHtml(item.status)} · 点击复购：${item.repurchaseClickedAt ? "是" : "否"}</div>
        </div>
        ${item.status === "CLAIMED" ? `<button data-coupon-id="${escapeHtml(item.couponId)}">标记使用</button>` : `<span class="pill">${escapeHtml(item.status)}</span>`}
      </div>`).join("")
    : `<div class="row"><div class="meta">暂无优惠券事件。</div></div>`;
  document.querySelector("#coupons").innerHTML = metricHtml + rows;
}

function setSamplePlaceholder() {
  const source = document.querySelector("#sample-source").value;
  const input = document.querySelector("#sample-input");
  const template = sampleTemplateForSource(source);
  input.placeholder = template ? template.csvTemplate : JSON.stringify(sampleExamples[source] || [], null, 2);
}

function sampleTemplateForSource(source) {
  return currentSampleTemplates.find((item) => item.sourceType === source) || null;
}

function renderSampleTemplate() {
  const source = document.querySelector("#sample-source").value;
  const template = sampleTemplateForSource(source);
  document.querySelector("#sample-template").innerHTML = template
    ? `<div class="template-box">
        <div class="template-head">
          <strong>${escapeHtml(template.label)}取样模板</strong>
          <span>至少 ${template.requiredSamples || 3} 条</span>
        </div>
        <div class="meta">必填：${escapeHtml((template.requiredFields || []).join("、"))}</div>
        <div class="meta">建议：${escapeHtml((template.recommendedFields || []).join("、"))}</div>
        <div class="script">${escapeHtml((template.notes || []).join("；"))}</div>
      </div>`
    : `<div class="meta">暂无取样模板。</div>`;
}

function readSamplePayload() {
  const text = document.querySelector("#sample-input").value.trim();
  if (text) return { text };
  throw new Error("请先粘贴真实样本，或点击“填入模板”后补齐真实数据");
}

function renderSampleResult(result) {
  const rows = result.rows || [];
  const summary = `<div class="sample-summary">
    <span>总数 ${result.total || 0}</span>
    <span>可导入 ${result.importableCount === undefined ? result.importedCount || 0 : result.importableCount}</span>
    <span>已导入 ${result.importedCount || 0}</span>
    <span>错误 ${result.errorCount || 0}</span>
    <span>提醒 ${result.warningCount || 0}</span>
  </div>`;
  const rowHtml = rows.length
    ? rows.map((row) => `<div class="sample-row">
        <div class="sample-row-head">
          <strong>#${row.index} · ${escapeHtml(row.status)}</strong>
          <span>${row.importable ? "可导入" : "不可导入"}</span>
        </div>
        ${row.errors && row.errors.length ? `<div class="sample-error">${escapeHtml(row.errors.join("；"))}</div>` : ""}
        ${row.warnings && row.warnings.length ? `<div class="sample-warning">${escapeHtml(row.warnings.join("；"))}</div>` : ""}
        <pre>${escapeHtml(JSON.stringify(row.mapped || {}, null, 2))}</pre>
      </div>`).join("")
    : `<div class="meta">暂无样本。</div>`;
  document.querySelector("#sample-result").innerHTML = summary + rowHtml;
}

function renderCoverage(coverage = {}) {
  const items = Object.entries(coverage)
    .sort((left, right) => {
      const leftRate = left[1] ? left[1].rate || 0 : 0;
      const rightRate = right[1] ? right[1].rate || 0 : 0;
      return leftRate - rightRate;
    })
    .slice(0, 5);
  return items.length
    ? items.map(([field, item]) => `<span>${escapeHtml(field)} ${item.rate || 0}%</span>`).join("")
    : `<span>暂无字段覆盖</span>`;
}

function renderReviewIssues(review) {
  const missing = review.missing_required_fields || [];
  const unknown = review.unknown_status_values || [];
  const parts = [];
  if (missing.length) parts.push(`缺失：${missing.map((item) => `${item.message} x${item.count}`).join("；")}`);
  if (unknown.length) parts.push(`未知枚举：${unknown.map((item) => `${item.field}=${item.value} x${item.count}`).join("；")}`);
  return parts.length ? parts.join(" · ") : "字段和状态枚举可继续验证";
}

function canonicalOptions(field) {
  const values = field === "orderStatus"
    ? ["PAID", "CLOSED", "REFUNDED"]
    : ["NOT_SHIPPED", "SHIPPED", "DELIVERED", "EXCEPTION"];
  return values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function renderMappingActions(review) {
  const unknown = review.unknown_status_values || [];
  return unknown.length
    ? `<div class="mapping-actions">
        ${unknown.map((item) => `<div class="mapping-row">
          <span>${escapeHtml(item.field)} = ${escapeHtml(item.value)}</span>
          <select aria-label="目标状态">${canonicalOptions(item.field)}</select>
          <button data-map-source="${escapeHtml(review.source_type)}" data-map-field="${escapeHtml(item.field)}" data-map-value="${escapeHtml(item.value)}">保存映射</button>
        </div>`).join("")}
      </div>`
    : "";
}

function renderExternalAdapterReadiness(readiness = {}) {
  const sources = readiness.sources || [];
  const requiredSamples = readiness.requiredSamples || 3;
  document.querySelector("#external-adapter-readiness").innerHTML = sources.length
    ? sources.map((source) => {
        const review = source.latestReview || {};
        const reasons = (source.blockingReasons || []).map((item) => item.message).join("；");
        const warnings = (source.warnings || []).map((item) => item.message).join("；");
        return `<div class="adapter-readiness-row">
          <div>
            <div class="sample-review-head">
              <strong>${escapeHtml(source.label)} · ${review.total || 0}/${requiredSamples} 条</strong>
              <span class="pill readiness-${escapeHtml(source.status || "").toLowerCase()}">${escapeHtml(source.status || "-")}</span>
            </div>
            <div class="meta">最新评审：${escapeHtml(review.decisionStatus || "暂无")} · 可导入 ${review.importableCount || 0} · 提醒 ${review.warningCount || 0} · 错误 ${review.errorCount || 0}</div>
            <div class="script">${escapeHtml(reasons || warnings || source.nextAction || "可继续")}</div>
          </div>
        </div>`;
      }).join("")
    : `<div class="meta">暂无准入结果。</div>`;
}

function renderExternalAdapters(catalog = {}, runs = []) {
  const adapters = catalog.adapters || [];
  const adapterRows = adapters.length
    ? adapters.map((adapter) => {
        const missing = (adapter.missingEnv || []).join("、");
        const cursor = adapter.cursor && adapter.cursor.cursor_value ? ` · 游标 ${adapter.cursor.cursor_value}` : "";
        const latest = adapter.latestRun
          ? ` · 最近 ${adapter.latestRun.status}${adapter.latestRun.error_message ? `：${adapter.latestRun.error_message}` : ""}`
          : "";
        return `<div class="external-adapter-row">
          <div>
            <div class="sample-review-head">
              <strong>${escapeHtml(adapter.label)}</strong>
              <span class="pill readiness-${escapeHtml(adapter.status || "").toLowerCase()}">${escapeHtml(adapter.status || "-")}</span>
            </div>
            <div class="meta">${escapeHtml(adapter.adapterKind)}${missing ? ` · 缺少 ${escapeHtml(missing)}` : ""}${escapeHtml(cursor)}${escapeHtml(latest)}</div>
            <div class="script">${escapeHtml(adapter.nextAction || "等待配置")}</div>
          </div>
        </div>`;
      }).join("")
    : `<div class="meta">暂无 Adapter 状态。</div>`;
  const latestRuns = runs.slice(0, 3).map((run) => `<div class="mini-run">
    <strong>${escapeHtml(run.source_type)} · ${escapeHtml(run.adapter_kind)} · ${escapeHtml(run.mode)}</strong>
    <span>${escapeHtml(run.status)} · 总数 ${run.total || 0} · 导入 ${run.imported_count || 0}${run.error_message ? ` · ${escapeHtml(run.error_message)}` : ""}</span>
  </div>`).join("");
  document.querySelector("#external-adapters").innerHTML = adapterRows + (latestRuns ? `<div class="run-list">${latestRuns}</div>` : "");
}

function renderSampleReviews(reviews = []) {
  document.querySelector("#sample-reviews").innerHTML = reviews.length
    ? reviews.map((review) => `<div class="sample-review-row">
        <div class="sample-review-head">
          <strong>${escapeHtml(review.source_type)} · ${escapeHtml(review.mode)} · ${escapeHtml(review.input_type)}</strong>
          <span class="pill">${escapeHtml(review.decision_status)}</span>
        </div>
        <div class="meta">总数 ${review.total || 0} · 可导入 ${review.importable_count || 0} · 已导入 ${review.imported_count || 0} · 错误 ${review.error_count || 0} · 提醒 ${review.warning_count || 0}</div>
        <div class="sample-coverage">${renderCoverage(review.field_coverage || {})}</div>
        <div class="script">${escapeHtml(renderReviewIssues(review))}</div>
        ${renderMappingActions(review)}
      </div>`).join("")
    : `<div class="meta">暂无取样记录。</div>`;
}

function renderKeyValues(items) {
  return items.map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`).join("");
}

function renderList(items, emptyText, mapper) {
  return items.length ? items.map(mapper).join("") : `<div class="meta">${escapeHtml(emptyText)}</div>`;
}

function renderUserDetail(detail) {
  const user = detail.user || {};
  const ops = detail.opsSummary || {};
  const profile = detail.profile || {};
  const refund = detail.refund || {};
  const refundEligibility = refund.eligibility || {};
  document.querySelector("#user-detail").innerHTML = `
    <div class="detail-grid">
      <section class="detail-section wide detail-summary-card">
        <div>
          <h3>${escapeHtml(user.nickname || "ROOT用户")} · ${escapeHtml(user.phone || "")}</h3>
          <p>${escapeHtml(ops.currentBlockage || "暂无明显卡点")}</p>
          <span>${escapeHtml(ops.nextAction || "保持观察")}</span>
        </div>
        <div class="task-actions">
          <span class="pill priority-${escapeHtml(String(ops.severity || "LOW").toLowerCase())}">${escapeHtml(ops.currentStatus || user.state || "-")}</span>
          <button data-follow-user-id="${escapeHtml(user.userId)}" data-source-type="MANUAL" data-source-id="USER_DETAIL" data-reason="${escapeHtml(`人工跟进：${ops.currentBlockage || "用户详情"}`)}">生成跟进待办</button>
        </div>
      </section>
      <section class="detail-section">
        <h3>当前状态</h3>
        ${renderKeyValues([
          ["状态", ops.stateLabel || user.state],
          ["当前周期", ops.currentStatus],
          ["订单状态", ops.orderStatusLabel],
          ["待办数", ops.openTaskCount],
          ["最近记录", ops.latestCheckinDate ? formatDateCn(ops.latestCheckinDate, dashboardReferenceDate()) : ""],
        ])}
      </section>
      <section class="detail-section">
        <h3>身体反馈画像</h3>
        ${renderKeyValues([
          ["参与原因", Array.isArray(profile.join_reasons) ? profile.join_reasons.join(", ") : ""],
          ["肠道状态", profile.gut_health_status],
          ["改善方式", Array.isArray(profile.improvement_methods) ? profile.improvement_methods.join(", ") : ""],
        ])}
      </section>
      <section class="detail-section">
        <h3>订单和物流</h3>
        ${renderList(detail.orders || [], "暂无订单", (order) => `
          <div class="mini-row">
            <strong>${escapeHtml(order.youzanOrderNo)}</strong>
            <span>${escapeHtml(order.deliveryStatus)} · ${escapeHtml(order.fulfillment ? order.fulfillment.lastEventText : "")}</span>
          </div>
        `)}
      </section>
      <section class="detail-section">
        <h3>退款追溯</h3>
        ${renderKeyValues([
          ["资格", refundEligibility.eligible ? "可进入人工退款" : "暂不可退款"],
          ["原因", refundEligibility.reason || "已满足条件"],
          ["工作项", refund.latest ? refund.latest.status : "暂无"],
        ])}
      </section>
      <section class="detail-section">
        <h3>优惠券</h3>
        ${renderList(detail.coupons || [], "暂无优惠券", (item) => `
          <div class="mini-row">
            <strong>${escapeHtml(item.title || item.couponType)}</strong>
            <span>${escapeHtml(item.experimentGroup)} · ${escapeHtml(item.status)} · ${escapeHtml(item.code || item.discountText || "")}</span>
          </div>
        `)}
      </section>
      <section class="detail-section wide">
        <h3>打卡记录</h3>
        ${renderList(detail.records || [], "暂无打卡记录", (record) => `
          <div class="mini-row">
            <strong>Day${record.day_index} · ${escapeHtml(formatDateCn(record.checkin_date, dashboardReferenceDate()))}</strong>
            <span>${escapeHtml(record.stool_type || "无便型")} · ${escapeHtml(record.feedback || "无反馈")}</span>
          </div>
        `)}
      </section>
      <section class="detail-section wide">
        <h3>问卷记录</h3>
        ${renderList(detail.questionnaireResponses || [], "暂无问卷", (item) => `
          <div class="mini-row">
            <strong>${escapeHtml(item.questionnaire_type)}</strong>
            <span>${escapeHtml(item.needs_follow ? "需跟进" : "无需跟进")} · ${escapeHtml((item.answers || {}).feedback || "")}</span>
          </div>
        `)}
      </section>
      <section class="detail-section wide">
        <h3>反馈聚合</h3>
        ${renderList(detail.feedbacks || [], "暂无反馈", (item) => `
          <div class="feedback-row">
            <div>
              <strong>${escapeHtml(item.title)} · ${escapeHtml(formatDateCn(item.date, dashboardReferenceDate()))}</strong>
              <p>${escapeHtml(item.text || "图片/便型反馈")}</p>
              <span class="pill">${escapeHtml(item.severity)}</span>
            </div>
            <button data-follow-user-id="${escapeHtml(user.userId)}" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${escapeHtml(item.sourceId)}" data-reason="${escapeHtml(`${item.title}：${item.text || "需要跟进"}`)}">生成跟进待办</button>
          </div>
        `)}
      </section>
      <section class="detail-section wide">
        <h3>相关待办</h3>
        ${renderList(detail.operationTasks || [], "暂无相关待办", (task) => `
          <div class="mini-row">
            <strong>${escapeHtml(task.taskType || task.task_type)} · ${escapeHtml(task.status)}</strong>
            <span>${escapeHtml(task.reason || "")}</span>
          </div>
        `)}
      </section>
    </div>`;
}

function renderCurrentUsers() {
  renderUsers(currentData ? currentData.opsUsers || currentData.users || [] : [], currentData ? currentData.sessions || [] : []);
}

async function loadUserDetail(userId) {
  currentDetailUserId = userId;
  const detail = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/detail`);
  renderUserDetail(detail);
}

async function load() {
  const data = await api("/api/v1/admin/dashboard");
  currentData = data;
  currentSampleTemplates = data.externalSampleTemplates || [];
  renderOpsDashboard(data.opsDashboard || {});
  renderMetrics(data.metrics);
  renderSummary(data.summary);
  renderDailyOpsSummary(data.dailyOpsSummary || {});
  renderLaunchReadiness(data.launchReadiness);
  renderAdapterCalibration(data.adapterCalibration || {});
  renderReleaseRecord(data.releaseRecord || {});
  renderCurrentUsers();
  setHtml("#user-candidates", renderUserCandidateRows(data.users || [], "暂无用户候选。"));
  renderRefunds(data.refunds);
  renderTaskFilter(data.operationTasks || []);
  renderTasks(data.operationTasks || []);
  renderMatchConflicts(data.operationTasks || []);
  renderImportBatches(data.importBatches || []);
  renderAuditLogs(data.auditLogs || []);
  renderReadyUsers(data.readyToStartUsers || []);
  renderCoupons(data.couponSummary || {}, data.coupons || []);
  renderSampleTemplate();
  renderExternalAdapterReadiness(data.externalAdapterReadiness || {});
  renderExternalAdapters(data.externalAdapterCatalog || {}, data.externalAdapterRuns || []);
  renderSampleReviews(data.externalSampleReviews || []);
  if (selectedOrderId || selectedUserId) await previewSelectedMatch();
  if (currentDetailUserId) await loadUserDetail(currentDetailUserId);
}

function on(selector, eventName, handler) {
  const element = document.querySelector(selector);
  if (element) element.addEventListener(eventName, handler);
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "readonly");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

on("#refresh", "click", load);
on("#admin-token", "click", async () => {
  promptAdminToken();
  await load();
});
on("#run-audit", "click", async () => {
  await api("/api/v1/jobs/daily-audit", { method: "POST", body: JSON.stringify({}) });
  await load();
});
on(".tab-nav", "click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (!button) return;
  setActiveTab(button.dataset.tab);
});
document.body.addEventListener("click", (event) => {
  const link = event.target.closest("[data-target-tab]");
  if (!link) return;
  setActiveTab(link.dataset.targetTab);
});
document.body.addEventListener("click", async (event) => {
  const orderButton = event.target.closest("[data-select-order-id]");
  if (orderButton) {
    selectedOrderId = orderButton.dataset.selectOrderId;
    setActiveTab("orders");
    await previewSelectedMatch();
    return;
  }
  const userButton = event.target.closest("[data-select-user-id]");
  if (userButton) {
    selectedUserId = userButton.dataset.selectUserId;
    setActiveTab("orders");
    await previewSelectedMatch();
    return;
  }
  const ignoreConflictButton = event.target.closest("[data-ignore-conflict-task-id]");
  if (ignoreConflictButton) {
    await ignoreMatchConflict(ignoreConflictButton.dataset.ignoreConflictTaskId);
    return;
  }
  const batchDetailButton = event.target.closest("[data-batch-detail-id]");
  if (batchDetailButton) {
    await loadImportBatchDetail(batchDetailButton.dataset.batchDetailId);
    return;
  }
  const batchExportButton = event.target.closest("[data-batch-export-id]");
  if (batchExportButton) {
    await exportBatchFailures(batchExportButton.dataset.batchExportId);
  }
});
on("#search-order-matching", "click", searchOrderMatching);
on("#order-match-search", "keydown", (event) => {
  if (event.key === "Enter") searchOrderMatching();
});
on("#clear-order-matching", "click", clearOrderMatchingSelection);
on("#sync-order", "click", syncManualOrderFromForm);
on("#confirm-match", "click", confirmSelectedMatch);
on("#toggle-bulk-orders", "click", toggleBulkOrderPanel);
on("#insert-bulk-order-template", "click", insertBulkOrderTemplate);
on("#bulk-order-file", "change", loadBulkOrderCsvFile);
on("#bulk-order-input", "input", () => {
  currentBulkOrderBatchId = "";
});
on("#preview-bulk-orders", "click", previewBulkOrders);
on("#import-bulk-orders", "click", importBulkOrders);
on("#insert-fulfillment-template", "click", insertFulfillmentTemplate);
on("#fulfillment-file", "change", loadFulfillmentCsvFile);
on("#fulfillment-input", "input", () => {
  currentFulfillmentBatchId = "";
});
on("#preview-fulfillment", "click", previewFulfillment);
on("#import-fulfillment", "click", importFulfillment);
on("#conflict-filter", "change", (event) => {
  currentConflictFilter = event.target.value;
  renderMatchConflicts(currentData ? currentData.operationTasks || [] : []);
});
on("#batch-source-filter", "change", (event) => {
  currentBatchSourceFilter = event.target.value;
  renderImportBatches(currentData ? currentData.importBatches || [] : []);
});
on("#audit-search", "input", (event) => {
  currentAuditKeyword = event.target.value.trim();
  renderAuditLogs(currentData ? currentData.auditLogs || [] : []);
});
on("#audit-action-filter", "change", (event) => {
  currentAuditAction = event.target.value;
  renderAuditLogs(currentData ? currentData.auditLogs || [] : []);
});
on("#task-filter", "change", (event) => {
  currentTaskType = event.target.value;
  renderTasks(currentData ? currentData.operationTasks || [] : []);
});
on("#user-search", "input", (event) => {
  currentUserKeyword = event.target.value.trim();
  renderCurrentUsers();
});
on("#user-filter", "change", (event) => {
  currentUserFilter = event.target.value;
  renderCurrentUsers();
});
on("#sample-source", "change", () => {
  setSamplePlaceholder();
  renderSampleTemplate();
  document.querySelector("#sample-result").innerHTML = `<div class="meta">粘贴 JSON、CSV 或表格文本后先预览校验，再导入可识别样本。</div>`;
});
on("#insert-sample-template", "click", () => {
  const source = document.querySelector("#sample-source").value;
  const template = sampleTemplateForSource(source);
  if (!template) return;
  document.querySelector("#sample-input").value = template.csvTemplate || template.csvHeader || "";
  document.querySelector("#sample-result").innerHTML = `<div class="meta">已填入 CSV 模板，请把空行补成真实导出样本后再预览。</div>`;
});
on("#preview-samples", "click", async () => {
  try {
    const data = await api("/api/v1/admin/external-samples/preview", {
      method: "POST",
      body: JSON.stringify({ sourceType: document.querySelector("#sample-source").value, ...readSamplePayload() }),
    });
    renderSampleResult(data);
  } catch (error) {
    document.querySelector("#sample-result").innerHTML = `<div class="sample-error">${escapeHtml(error.message)}</div>`;
  }
});
on("#import-samples", "click", async () => {
  try {
    const data = await api("/api/v1/admin/external-samples/import", {
      method: "POST",
      body: JSON.stringify({ sourceType: document.querySelector("#sample-source").value, ...readSamplePayload() }),
    });
    renderSampleResult(data);
    await load();
  } catch (error) {
    document.querySelector("#sample-result").innerHTML = `<div class="sample-error">${escapeHtml(error.message)}</div>`;
  }
});
on("#sample-reviews", "click", async (event) => {
  const button = event.target.closest("button[data-map-value]");
  if (!button) return;
  const row = button.closest(".mapping-row");
  const canonicalValue = row.querySelector("select").value;
  await api("/api/v1/admin/external-status-mappings", {
    method: "POST",
    body: JSON.stringify({
      sourceType: button.dataset.mapSource,
      field: button.dataset.mapField,
      rawValue: button.dataset.mapValue,
      canonicalValue,
    }),
  });
  await load();
});
on("#refunds", "click", async (event) => {
  const id = event.target.dataset.id;
  if (!id) return;
  await api(`/api/v1/admin/refunds/${id}/approve`, { method: "POST" });
  await load();
});
on("#coupons", "click", async (event) => {
  const couponId = event.target.dataset.couponId;
  if (!couponId) return;
  await api(`/api/v1/admin/coupons/${couponId}/use`, { method: "POST" });
  await load();
});
async function handleTaskAction(event) {
  const copyScript = event.target.dataset.copyScript;
  if (copyScript) {
    await copyText(copyScript);
    event.target.textContent = "已复制";
    return;
  }
  const taskId = event.target.dataset.taskId;
  if (!taskId) return;
  await api(`/api/v1/admin/tasks/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: event.target.dataset.status || "DONE",
      note: event.target.dataset.note || "",
    }),
  });
  await load();
}

["#tasks", "#priority-tasks"].forEach((selector) => {
  on(selector, "click", handleTaskAction);
});
["#users", "#tasks", "#priority-tasks", "#ready-users", "#ready-users-preview", "#risk-feedbacks", "#risk-feedback-preview"].forEach((selector) => {
  on(selector, "click", async (event) => {
    const userId = event.target.dataset.detailUserId;
    if (!userId) return;
    await loadUserDetail(userId);
    setActiveTab("users");
  });
});
on("#user-detail", "click", async (event) => {
  const userId = event.target.dataset.followUserId;
  if (!userId) return;
  await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/follow`, {
    method: "POST",
    body: JSON.stringify({
      sourceType: event.target.dataset.sourceType || "",
      sourceId: event.target.dataset.sourceId || "",
      reason: event.target.dataset.reason || "用户反馈需要跟进",
    }),
  });
  await load();
});

setSamplePlaceholder();
load().catch((error) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="padding:20px;color:#9b332c">${error.message}</p>`);
});
