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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
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

function renderMetrics(metrics) {
  document.querySelector("#metrics").innerHTML = Object.entries(labels)
    .map(([key, label]) => `<article class="metric"><strong>${metrics[key] || 0}</strong><span>${label}</span></article>`)
    .join("");
}

function renderSummary(summary = {}) {
  document.querySelector("#summary").innerHTML = Object.entries(summaryLabels)
    .map(([key, label]) => `<article class="summary-item"><strong>${summary[key] || 0}</strong><span>${label}</span></article>`)
    .join("") + `<div class="summary-date">日期：${escapeHtml(summary.date || "今日")} · 生成待办：${summary.generatedTasks || 0}</div>`;
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

function renderUsers(users, sessions) {
  document.querySelector("#users").innerHTML = users.length
    ? users
        .map((user) => {
          const session = sessions.find((item) => item.userId === user.userId);
          return `<div class="row">
	            <div>
	              <div class="title">${escapeHtml(user.nickname)} · ${escapeHtml(user.phone)}</div>
	              <div class="meta">状态：${escapeHtml(user.state)} · 当前周期：${escapeHtml(session ? session.status : "暂无")}</div>
	            </div>
	            <div class="task-actions">
	              <span class="pill">${escapeHtml(user.state)}</span>
	              <button class="ghost" data-detail-user-id="${escapeHtml(user.userId)}">详情</button>
	            </div>
	          </div>`;
        })
        .join("")
    : `<div class="row"><div class="meta">暂无用户，先在小程序登录体验。</div></div>`;
}

function renderRefunds(refunds) {
  document.querySelector("#refunds").innerHTML = refunds.length
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
    : `<div class="row"><div class="meta">暂无免单申请。</div></div>`;
}

function renderTaskFilter(tasks) {
  const select = document.querySelector("#task-filter");
  const types = [...new Set(tasks.map((task) => task.taskType || task.task_type).filter(Boolean))].sort();
  select.innerHTML = `<option value="">全部类型</option>` + types
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join("");
  select.value = types.includes(currentTaskType) ? currentTaskType : "";
  currentTaskType = select.value;
}

function renderTasks(tasks) {
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
              <div class="title">${escapeHtml(type)} · ${escapeHtml(user)}</div>
              <div class="meta">${escapeHtml(task.reason || "待处理")}</div>
              <div class="meta">动作：${escapeHtml(task.suggestedAction || task.suggested_action || "联系用户确认")}</div>
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

function renderReadyUsers(items) {
  document.querySelector("#ready-users").innerHTML = items.length
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
    : `<div class="row"><div class="meta">暂无已送达待开始用户。</div></div>`;
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
  const profile = detail.profile || {};
  const refund = detail.refund || {};
  const refundEligibility = refund.eligibility || {};
  document.querySelector("#user-detail").innerHTML = `
    <div class="detail-grid">
      <section class="detail-section">
        <h3>${escapeHtml(user.nickname || "ROOT用户")} · ${escapeHtml(user.phone || "")}</h3>
        ${renderKeyValues([
          ["状态", user.state],
          ["总打卡", user.totalCheckinDays],
          ["当前连续", user.currentStreak],
          ["最长连续", user.longestStreak],
        ])}
      </section>
      <section class="detail-section">
        <h3>画像</h3>
        ${renderKeyValues([
          ["参与原因", Array.isArray(profile.join_reasons) ? profile.join_reasons.join(", ") : ""],
          ["肠道状态", profile.gut_health_status],
          ["改善方式", Array.isArray(profile.improvement_methods) ? profile.improvement_methods.join(", ") : ""],
          ["日常便型", profile.stool_type],
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
            <strong>Day${record.day_index} · ${escapeHtml(record.checkin_date)}</strong>
            <span>${escapeHtml(record.stool_type || "无便型")} · ${escapeHtml(record.feedback || "无反馈")}</span>
          </div>
        `)}
      </section>
      <section class="detail-section wide">
        <h3>问卷</h3>
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
              <strong>${escapeHtml(item.title)} · ${escapeHtml(item.date)}</strong>
              <p>${escapeHtml(item.text || "图片/便型反馈")}</p>
              <span class="pill">${escapeHtml(item.severity)}</span>
            </div>
            <button data-follow-user-id="${escapeHtml(user.userId)}" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${escapeHtml(item.sourceId)}" data-reason="${escapeHtml(`${item.title}：${item.text || "需要跟进"}`)}">生成 follow</button>
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

async function loadUserDetail(userId) {
  currentDetailUserId = userId;
  const detail = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/detail`);
  renderUserDetail(detail);
}

async function load() {
  const data = await api("/api/v1/admin/dashboard");
  currentData = data;
  currentSampleTemplates = data.externalSampleTemplates || [];
  renderMetrics(data.metrics);
  renderSummary(data.summary);
  renderLaunchReadiness(data.launchReadiness);
  renderAdapterCalibration(data.adapterCalibration || {});
  renderReleaseRecord(data.releaseRecord || {});
  renderUsers(data.users, data.sessions);
  renderRefunds(data.refunds);
  renderTaskFilter(data.operationTasks || []);
  renderTasks(data.operationTasks || []);
  renderReadyUsers(data.readyToStartUsers || []);
  renderCoupons(data.couponSummary || {}, data.coupons || []);
  renderSampleTemplate();
  renderExternalAdapterReadiness(data.externalAdapterReadiness || {});
  renderExternalAdapters(data.externalAdapterCatalog || {}, data.externalAdapterRuns || []);
  renderSampleReviews(data.externalSampleReviews || []);
  if (currentDetailUserId) await loadUserDetail(currentDetailUserId);
}

document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#run-audit").addEventListener("click", async () => {
  await api("/api/v1/jobs/daily-audit", { method: "POST", body: JSON.stringify({}) });
  await load();
});
document.querySelector("#task-filter").addEventListener("change", (event) => {
  currentTaskType = event.target.value;
  renderTasks(currentData ? currentData.operationTasks || [] : []);
});
document.querySelector("#sample-source").addEventListener("change", () => {
  setSamplePlaceholder();
  renderSampleTemplate();
  document.querySelector("#sample-result").innerHTML = `<div class="meta">粘贴 JSON、CSV 或表格文本后先预览校验，再导入可识别样本。</div>`;
});
document.querySelector("#insert-sample-template").addEventListener("click", () => {
  const source = document.querySelector("#sample-source").value;
  const template = sampleTemplateForSource(source);
  if (!template) return;
  document.querySelector("#sample-input").value = template.csvTemplate || template.csvHeader || "";
  document.querySelector("#sample-result").innerHTML = `<div class="meta">已填入 CSV 模板，请把空行补成真实导出样本后再预览。</div>`;
});
document.querySelector("#preview-samples").addEventListener("click", async () => {
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
document.querySelector("#import-samples").addEventListener("click", async () => {
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
document.querySelector("#sample-reviews").addEventListener("click", async (event) => {
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
document.querySelector("#refunds").addEventListener("click", async (event) => {
  const id = event.target.dataset.id;
  if (!id) return;
  await api(`/api/v1/admin/refunds/${id}/approve`, { method: "POST" });
  await load();
});
document.querySelector("#coupons").addEventListener("click", async (event) => {
  const couponId = event.target.dataset.couponId;
  if (!couponId) return;
  await api(`/api/v1/admin/coupons/${couponId}/use`, { method: "POST" });
  await load();
});
document.querySelector("#tasks").addEventListener("click", async (event) => {
  const taskId = event.target.dataset.taskId;
  if (!taskId) return;
  await api(`/api/v1/admin/tasks/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify({ status: event.target.dataset.status || "DONE" }),
  });
  await load();
});
["#users", "#tasks", "#ready-users"].forEach((selector) => {
  document.querySelector(selector).addEventListener("click", async (event) => {
    const userId = event.target.dataset.detailUserId;
    if (!userId) return;
    await loadUserDetail(userId);
  });
});
document.querySelector("#user-detail").addEventListener("click", async (event) => {
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
