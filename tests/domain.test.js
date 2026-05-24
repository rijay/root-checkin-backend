const test = require("node:test");
const assert = require("node:assert/strict");

const domain = require("../src/domain");
const { addDays } = require("../src/dates");

function register(store, phone = "13800000001") {
  const login = domain.login(store, { phone }).data;
  domain.submitProfile(store, login.token, {
    joinReasons: ["health", "gut_flora"],
    gutHealthStatus: "normal",
    improvementMethods: ["diet", "probiotics"],
    stoolType: "type4",
  });
  return login.token;
}

function startMatchedCheckin(store, token, date = "2026-04-26") {
  domain.matchOrder(store, token, { phone: "13800000001" }, date);
  domain.startCheckin(store, token, { confirmReceived: true }, date);
}

function completeSevenDays(store, token, startDate = "2026-04-26") {
  for (let day = 1; day <= 7; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays(startDate, day - 1)
    );
  }
}

test("matches a delivered order without starting check-in automatically", () => {
  const store = domain.createStore();
  const token = register(store);
  const matched = domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26").data;

  assert.equal(matched.user.state, domain.STATES.REGISTERED_IDLE);
  assert.equal(matched.order.youzanOrderNo, "YZROOT202604260001");
  assert.equal(matched.order.deliveryStatus, "DELIVERED");
  assert.equal(matched.nextAction, "READY_TO_START");
  assert.equal(matched.canStartCheckin, true);
  assert.equal(matched.session, null);
  assert.equal(store.checkinSessions.length, 0);
  assert.equal(store.identityLinks[0].receiver_phone, "13800000001");
  const state = domain.getUserState(store, token).data;
  assert.equal(state.flowView, "READY_TO_START");
  assert.deepEqual(state.allowedActions, ["START_CHECKIN"]);
});

test("starts check-in only after a matched order is delivered", () => {
  const store = domain.createStore();
  const token = register(store);
  domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26");

  const started = domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26").data;

  assert.equal(started.user.state, domain.STATES.CHECKIN_ACTIVE);
  assert.equal(started.session.orderId, "ord_root_001");
  assert.equal(started.session.startDate, "2026-04-26");
});

test("matched shipped order waits for delivery before starting check-in", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  const matched = domain.matchOrder(store, token, { phone: "13800000002" }, "2026-04-26").data;

  assert.equal(matched.user.state, domain.STATES.REGISTERED_IDLE);
  assert.equal(matched.order.deliveryStatus, "SHIPPED");
  assert.equal(matched.nextAction, "WAITING_DELIVERY");
  assert.equal(matched.canStartCheckin, false);
  assert.equal(domain.getUserState(store, token).data.flowView, "WAITING_DELIVERY");
  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /物流送达后才能开始打卡/);
});

test("order already bound to another user enters conflict path", () => {
  const store = domain.createStore();
  const token = register(store, "13800000003");

  assert.throws(() => domain.matchOrder(store, token, { phone: "13800000099" }, "2026-04-26"), /订单已被其他用户绑定/);
  assert.equal(store.operationTasks.length, 1);
  assert.equal(store.operationTasks[0].task_type, "MANUAL_REVIEW_REQUIRED");
  assert.equal(domain.getUserState(store, token).data.flowView, "MANUAL_REVIEW_REQUIRED");
  assert.equal(store.checkinSessions.length, 0);
});

test("start check-in requires a matched order", () => {
  const store = domain.createStore();
  const token = register(store, "13800000888");

  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /请先匹配/);
  assert.equal(store.operationTasks[0].task_type, "MANUAL_REVIEW_REQUIRED");
  assert.equal(domain.getUserState(store, token).data.flowView, "MANUAL_REVIEW_REQUIRED");
});

test("delivered fulfillment creates ready-to-start task once", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  domain.matchOrder(store, token, { phone: "13800000002" }, "2026-04-26");

  const updated = domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27").data;
  const repeated = domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27").data;
  const ready = domain.getReadyToStartUsers(store, "2026-04-27").data.users;

  assert.equal(updated.task.task_type, "DELIVERED_NOT_STARTED");
  assert.equal(repeated.task.task_id, updated.task.task_id);
  assert.equal(store.operationTasks.length, 1);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].order.orderId, "ord_root_002");
  assert.equal(domain.getUserState(store, token).data.flowView, "READY_TO_START");
});

test("external adapter samples import orders and fulfillment updates", () => {
  const store = domain.createStore();
  const orderImport = domain.importExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    samples: [
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
  }, "2026-05-16").data;
  const fulfillmentImport = domain.importExternalSamples(store, {
    sourceType: "FULFILLMENT",
    samples: [
      {
        有赞订单号: "YZROOT202605160001",
        快递公司: "SF",
        运单号: "SFROOT0516001",
        物流状态: "已签收",
        签收时间: "2026-05-18T11:20:00+08:00",
        最新物流节点: "本人签收",
      },
    ],
  }, "2026-05-18").data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160001");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(orderImport.importedCount, 1);
  assert.equal(fulfillmentImport.importedCount, 1);
  assert.equal(order.receiver_phone, "13800001111");
  assert.equal(order.order_status, "PAID");
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.tracking_no, "SFROOT0516001");
});

test("external adapter samples validate and import wechat leads", () => {
  const store = domain.createStore();
  const preview = domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    samples: [{ 收货人: "缺少订单号" }],
  }).data;
  const imported = domain.importExternalSamples(store, {
    sourceType: "WECHAT_LEAD",
    samples: [
      {
        外部联系人ID: "wm_external_sample_001",
        企业微信备注名: "林小样-ROOT试饮",
        来源活动: "线下沙龙",
        当前添加状态: "ADDED",
        运营备注: "已发送入组规则",
      },
    ],
  }, "2026-05-16").data;

  assert.equal(preview.errorCount, 1);
  assert.equal(preview.rows[0].importable, false);
  assert.equal(imported.importedCount, 1);
  assert.equal(store.leadProfiles[0].external_contact_id, "wm_external_sample_001");
  assert.equal(store.operationTasks[0].task_type, "LEAD_NEEDS_MATCHING");
});

test("external adapter samples accept CSV and spreadsheet text", () => {
  const store = domain.createStore();
  const orderCsv = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605160088,周表格,13800008888,ROOT 7日试饮装,199,已支付,已发货,上海市表格地址",
  ].join("\n");
  const fulfillmentTsv = [
    "有赞订单号\t快递公司\t运单号\t物流状态\t签收时间\t最新物流节点",
    "YZROOT202605160088\tSF\tSFROOT0888\t已签收\t2026-05-18T10:00:00+08:00\t本人签收",
  ].join("\n");

  const orderImport = domain.importExternalSamples(store, { sourceType: "YOUZAN_ORDER", text: orderCsv }, "2026-05-16").data;
  const fulfillmentImport = domain.importExternalSamples(store, { sourceType: "FULFILLMENT", text: fulfillmentTsv }, "2026-05-18").data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160088");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(orderImport.importedCount, 1);
  assert.equal(fulfillmentImport.importedCount, 1);
  assert.equal(order.receiver_phone, "13800008888");
  assert.equal(order.amount, 199);
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.last_event_text, "本人签收");
});

test("manual external platform Adapter imports through the shared sample Interface", async () => {
  const store = domain.createStore();
  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160099,赵Adapter,13800009999,ROOT 7日试饮装,199,已支付,已发货,上海市Adapter地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160099");

  assert.equal(imported.success, true);
  assert.equal(imported.adapterKind, "MANUAL_SAMPLE");
  assert.equal(imported.mode, "IMPORT");
  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.review.mode, "ADAPTER_IMPORT");
  assert.equal(imported.run.imported_count, 1);
  assert.equal(store.externalAdapterRuns[0].run_id, imported.run.run_id);
  assert.equal(order.receiver_phone, "13800009999");

  await assert.rejects(
    () => domain.runExternalAdapter(store, { sourceType: "YOUZAN_ORDER", adapterKind: "YOUZAN_OPEN" }, { env: {} }, "2026-05-16"),
    /未配置/
  );
  assert.equal(store.externalAdapterRuns[0].status, "FAILED");
  assert.match(store.externalAdapterRuns[0].error_message, /未配置/);
});

test("real external platform Adapter Implementation can advance cursor after import", async () => {
  const store = domain.createStore();
  const context = {
    env: { YOUZAN_CLIENT_ID: "client", YOUZAN_CLIENT_SECRET: "secret" },
    adapterImplementations: {
      YOUZAN_OPEN: ({ cursor, limit }) => ({
        samples: [
          {
            有赞订单号: "YZROOT202605160199",
            收货人: "钱增量",
            收货手机号: "13800019999",
            商品名称: "ROOT 7日试饮装",
            实付金额: "199",
            订单状态: "已支付",
            物流状态: "已发货",
            收货地址: "上海市增量地址",
          },
        ],
        externalCount: limit,
        nextCursor: cursor ? `${cursor}-next` : "cursor-001",
        hasMore: false,
      }),
    },
  };
  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const catalog = domain.getExternalAdapters(store, context).data;

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.adapter_kind, "YOUZAN_OPEN");
  assert.equal(imported.run.cursor_after, "cursor-001");
  assert.equal(imported.cursor.cursor_value, "cursor-001");
  assert.equal(catalog.cursors[0].cursor_value, "cursor-001");
  assert.equal(catalog.catalog.realAdapters.find((item) => item.adapterKind === "YOUZAN_OPEN").status, "READY");
});

test("built-in Youzan HTTP Adapter maps configurable response and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      YOUZAN_CLIENT_ID: "client",
      YOUZAN_CLIENT_SECRET: "secret",
      YOUZAN_ACCESS_TOKEN: "token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.example/open/orders",
      YOUZAN_ORDER_LIST_DATA_PATH: "data.items",
      YOUZAN_ORDER_LIST_CURSOR_PATH: "data.nextCursor",
      YOUZAN_ORDER_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: [
              {
                tid: "YZROOT202605160299",
                receiver_name: "孙HTTP",
                receiver_tel: "13800029999",
                orders: [{ title: "ROOT 7日试饮装", item_id: "ROOT-PREBIOTIC-TRIAL" }],
                pay_amount: "199",
                status: "已支付",
                shipping_status: "已发货",
                address: "上海市HTTP地址",
              },
            ],
            nextCursor: "youzan-cursor-002",
            hasMore: true,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160299");

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "youzan-cursor-002");
  assert.equal(imported.run.has_more, true);
  assert.equal(imported.cursor.cursor_value, "youzan-cursor-002");
  assert.equal(order.receiver_phone, "13800029999");
  assert.equal(calls[0].url, "https://youzan.example/open/orders?access_token=token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("built-in fulfillment HTTP Adapter updates delivery status and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      ROOT_FULFILLMENT_SECRET: "fulfillment-secret",
      ROOT_FULFILLMENT_LIST_URL: "https://fulfillment.example/events",
      ROOT_FULFILLMENT_LIST_DATA_PATH: "data.events",
      ROOT_FULFILLMENT_LIST_CURSOR_PATH: "data.nextCursor",
      ROOT_FULFILLMENT_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            events: [
              {
                order_no: "YZROOT202604260002",
                express_company: "SF",
                waybill_no: "SFHTTP0002",
                logistics_status: "已签收",
                signed_at: "2026-05-16T12:30:00+08:00",
                latest_trace: "本人签收",
              },
            ],
            nextCursor: "fulfillment-cursor-002",
            hasMore: false,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "FULFILLMENT",
    adapterKind: "FULFILLMENT_PUSH",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202604260002");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "fulfillment-cursor-002");
  assert.equal(imported.cursor.cursor_value, "fulfillment-cursor-002");
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.tracking_no, "SFHTTP0002");
  assert.equal(calls[0].url, "https://fulfillment.example/events");
  assert.equal(calls[0].init.headers["X-Root-Fulfillment-Secret"], "fulfillment-secret");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("built-in WeWork contact HTTP Adapter imports leads and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      WEWORK_CORP_ID: "corp-root",
      WEWORK_CONTACT_SECRET: "contact-secret",
      WEWORK_ACCESS_TOKEN: "access-token",
      WEWORK_CONTACT_LIST_URL: "https://wework.example/external-contacts",
      WEWORK_CONTACT_LIST_DATA_PATH: "data.contacts",
      WEWORK_CONTACT_LIST_CURSOR_PATH: "data.nextCursor",
      WEWORK_CONTACT_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            contacts: [
              {
                external_userid: "wm_http_001",
                remark: "周企微-ROOT试饮",
                mobile: "13800038888",
                source: "线下沙龙",
                activity_name: "五月试饮会",
                status: "ADDED",
                note: "已发送入组规则",
              },
            ],
            nextCursor: "wework-cursor-002",
            hasMore: false,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "WECHAT_LEAD",
    adapterKind: "WEWORK_CONTACT",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const lead = store.leadProfiles.find((item) => item.external_contact_id === "wm_http_001");

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "wework-cursor-002");
  assert.equal(imported.cursor.cursor_value, "wework-cursor-002");
  assert.equal(lead.wechat_remark_name, "周企微-ROOT试饮");
  assert.equal(lead.receiver_phone, "13800038888");
  assert.equal(lead.source_channel, "线下沙龙");
  assert.equal(calls[0].url, "https://wework.example/external-contacts?access_token=access-token");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("adapter calibration reports config, runs, and cursors by source", async () => {
  const store = domain.createStore();
  const missing = domain.getAdapterCalibration(store, { env: {} }).data;

  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.sources.find((item) => item.adapterKind === "YOUZAN_OPEN").checks.some((check) => check.id === "configuration" && check.status === "BLOCKER"), true);

  const context = {
    env: { YOUZAN_CLIENT_ID: "client", YOUZAN_CLIENT_SECRET: "secret" },
    adapterImplementations: {
      YOUZAN_OPEN: () => ({
        samples: [
          {
            有赞订单号: "YZROOT202605160399",
            收货人: "校准用户",
            收货手机号: "13800039999",
            商品名称: "ROOT 7日试饮装",
            实付金额: "199",
            订单状态: "已支付",
            物流状态: "已发货",
            收货地址: "上海市校准地址",
          },
        ],
        nextCursor: "calibration-cursor-001",
      }),
    },
  };
  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16");
  const calibration = domain.getAdapterCalibration(store, {
    ...context,
    env: { ...context.env, YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
  }).data;
  const youzan = calibration.sources.find((item) => item.adapterKind === "YOUZAN_OPEN");

  assert.equal(youzan.checks.find((check) => check.id === "latest_run").status, "PASS");
  assert.equal(youzan.checks.find((check) => check.id === "cursor").status, "PASS");
  assert.equal(youzan.env.required.every((item) => item.present), true);
});

test("release record gathers readiness, calibration, runs, and rollback evidence", async () => {
  const store = domain.createStore();
  const missing = domain.getReleaseRecord(store, { env: {} }).data;

  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.decision.recommendation, "暂缓发布，先处理阻塞项");
  assert.ok(missing.checklist.mustFixBeforeRelease.length > 0);
  assert.ok(missing.evidence.launchReadiness.blockers.length > 0);
  assert.equal(missing.signoffs.length, 3);
  assert.ok(missing.rollback.some((item) => item.includes("MANUAL_SAMPLE")));

  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "PREVIEW",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160499,发布记录,13800049999,ROOT 7日试饮装,199,已支付,已发货,上海市发布地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16");
  const record = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;

  assert.equal(record.target, "gray");
  assert.equal(record.evidence.recentAdapterRuns[0].adapterKind, "MANUAL_SAMPLE");
  assert.equal(record.evidence.recentAdapterRuns[0].status, "COMPLETED");
  assert.ok(record.checklist.finalChecks.some((item) => item.includes("ROOT_PUBLIC_BASE_URL")));
});

test("external adapter sample reviews track coverage and unknown status values", () => {
  const store = domain.createStore();
  const result = domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货手机号,订单状态,物流状态",
      "YZROOT202605160077,13800007777,已支付,派送失败",
    ].join("\n"),
  }).data;
  const review = result.review;
  const dashboard = domain.adminDashboard(store).data;

  assert.equal(result.importableCount, 0);
  assert.equal(review.decision_status, "NEEDS_MAPPING");
  assert.equal(review.field_coverage.youzanOrderNo.rate, 100);
  assert.equal(review.field_coverage.rawAddressText.rate, 0);
  assert.equal(review.unknown_status_values[0].field, "deliveryStatus");
  assert.equal(review.unknown_status_values[0].value, "派送失败");
  assert.equal(store.externalSampleReviews[0].review_id, review.review_id);
  assert.equal(dashboard.externalSampleReviews[0].decision_status, "NEEDS_MAPPING");
});

test("external status mappings resolve unknown sample values", () => {
  const store = domain.createStore();
  const text = [
    "有赞订单号,收货手机号,订单状态,物流状态",
    "YZROOT202605160078,13800007778,已支付,派送失败",
  ].join("\n");
  const before = domain.previewExternalSamples(store, { sourceType: "YOUZAN_ORDER", text }).data;
  const mapping = domain.upsertExternalStatusMapping(store, {
    sourceType: "YOUZAN_ORDER",
    field: "deliveryStatus",
    rawValue: "派送失败",
    canonicalValue: "EXCEPTION",
  }).data.mapping;
  const after = domain.previewExternalSamples(store, { sourceType: "YOUZAN_ORDER", text }).data;
  const dashboard = domain.adminDashboard(store).data;

  assert.equal(before.review.decision_status, "NEEDS_MAPPING");
  assert.equal(mapping.canonical_value, "EXCEPTION");
  assert.equal(after.rows[0].mapped.deliveryStatus, "EXCEPTION");
  assert.equal(after.importableCount, 1);
  assert.equal(after.review.decision_status, "NEEDS_REVIEW");
  assert.equal(dashboard.externalStatusMappings[0].raw_value, "派送失败");
});

test("external adapter readiness requires three clean samples per source", () => {
  const store = domain.createStore();
  domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160101,张样本,13800010101,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1号",
    ].join("\n"),
  });
  const firstReadiness = domain.adminDashboard(store).data.externalAdapterReadiness;
  assert.equal(firstReadiness.status, "BLOCKED");
  assert.equal(firstReadiness.sources.find((item) => item.sourceType === "YOUZAN_ORDER").blockingReasons[0].code, "INSUFFICIENT_SAMPLES");

  domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160101,张样本,13800010101,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1号",
      "YZROOT202605160102,李样本,13800010102,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址2号",
      "YZROOT202605160103,王样本,13800010103,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址3号",
    ].join("\n"),
  });
  domain.previewExternalSamples(store, {
    sourceType: "FULFILLMENT",
    text: [
      "有赞订单号,快递公司,运单号,物流状态,签收时间,最新物流节点",
      "YZROOT202605160101,SF,SFROOT101,已签收,2026-05-18T10:00:00+08:00,本人签收",
      "YZROOT202605160102,SF,SFROOT102,已签收,2026-05-18T11:00:00+08:00,门店代收",
      "YZROOT202605160103,SF,SFROOT103,已签收,2026-05-18T12:00:00+08:00,本人签收",
    ].join("\n"),
  });
  domain.previewExternalSamples(store, {
    sourceType: "WECHAT_LEAD",
    text: [
      "外部联系人ID,企业微信备注名,来源活动,当前添加状态,收货手机号,运营备注",
      "wm_root_101,张样本-ROOT,线下沙龙,ADDED,13800010101,已发送规则",
      "wm_root_102,李样本-ROOT,线下沙龙,ADDED,13800010102,已发送规则",
      "wm_root_103,王样本-ROOT,线下沙龙,ADDED,13800010103,已发送规则",
    ].join("\n"),
  });
  const readiness = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: { kind: "sqlite", filePath: "/tmp/root-checkin.sqlite" },
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://api.root.test",
    },
  }).data;

  assert.equal(readiness.adapterReadiness.status, "READY");
  assert.equal(readiness.summary.blockers, 0);
  assert.ok(readiness.checks.filter((item) => item.id.startsWith("sample_")).every((item) => item.status === "PASS"));
});

test("launch readiness separates gray trial warnings from production blockers", () => {
  const store = domain.createStore();
  const production = domain.adminLaunchReadiness(store, { target: "production", storeAdapter: { kind: "memory" }, env: {} }).data;
  const gray = domain.adminLaunchReadiness(store, { target: "gray", storeAdapter: { kind: "json-file" }, env: {} }).data;
  const sqliteProduction = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: { kind: "sqlite", filePath: "/tmp/root-checkin.sqlite" },
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://root.example.com",
    },
  }).data;

  assert.equal(production.status, "BLOCKED");
  assert.ok(production.checks.some((item) => item.id === "store_adapter" && item.status === "BLOCKER"));
  assert.ok(production.checks.some((item) => item.id === "wechat_credentials" && item.status === "BLOCKER"));
  assert.equal(gray.status, "NEEDS_REVIEW");
  assert.equal(gray.summary.blockers, 0);
  assert.ok(gray.checks.some((item) => item.id === "store_adapter" && item.status === "PASS"));
  assert.ok(sqliteProduction.checks.some((item) => item.id === "store_adapter" && item.status === "PASS"));
});

test("manual review can be resolved into a started check-in", () => {
  const store = domain.createStore();
  const token = register(store, "13800000888");
  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /请先匹配/);

  const task = store.operationTasks[0];
  const resolved = domain.resolveManualReview(store, task.task_id, { action: "ALLOW_START" }, "2026-04-26").data;

  assert.equal(resolved.task.result, "ALLOWED_START");
  assert.equal(resolved.user.state, domain.STATES.CHECKIN_ACTIVE);
  assert.equal(resolved.session.orderId, null);
});

test("matched order can complete seven days and create a pending refund application", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);

  assert.throws(() => domain.applyRefund(store, token), /Day8 收尾问卷/);
  const questionnaireResult = domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "maybe", needsContact: false },
    idempotencyKey: "day8-refund",
  }).data;

  const state = domain.getUserState(store, token).data.user;
  const refund = domain.applyRefund(store, token).data.refundWorkItem;

  assert.equal(questionnaireResult.refundWorkItem.status, "PENDING");
  assert.equal(state.state, domain.STATES.CHECKIN_COMPLETED);
  assert.equal(refund.status, "PENDING");
  assert.equal(refund.amount, 199);
});

test("Day4 questionnaire pending does not block Day5 check-in", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 4; day += 1) {
    const result = domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    ).data;
    if (day === 4) assert.equal(result.nextAction, "DAY4_QUESTIONNAIRE");
  }
  assert.equal(domain.getUserState(store, token).data.flowView, "DAY4_PENDING");

  const day5 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 5, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 5" },
    "2026-04-30"
  ).data;

  assert.equal(day5.record.day_index, 5);
  assert.equal(store.operationTasks.some((task) => task.task_type === "DAY4_QUESTIONNAIRE_PENDING"), true);

  domain.submitQuestionnaire(store, token, {
    type: "DAY4_MIDPOINT",
    answers: { stoolChange: "better", comfortScore: 4, needsContact: false },
    idempotencyKey: "day4-ok",
  });

  assert.equal(store.operationTasks.some((task) => task.task_type === "DAY4_QUESTIONNAIRE_PENDING" && task.status === "OPEN"), false);
});

test("daily audit fails a session after three missed days", () => {
  const store = domain.createStore();
  const token = register(store);
  domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26");
  domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26");

  domain.runDailyAudit(store, "2026-04-27");
  domain.runDailyAudit(store, "2026-04-28");
  domain.runDailyAudit(store, "2026-04-29");

  const state = domain.getUserState(store, token).data.user;
  assert.equal(state.state, domain.STATES.CHECKIN_FAILED);
});

test("daily audit creates a summary and does not reopen handled tasks on the same date", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  const firstAudit = domain.runDailyAudit(store, "2026-04-27").data;
  const missedTask = store.operationTasks.find((task) => task.task_type === "MISSED_CHECKIN");

  assert.equal(firstAudit.summary.date, "2026-04-27");
  assert.equal(firstAudit.summary.dueToday, 1);
  assert.equal(firstAudit.summary.missedToday, 1);
  assert.equal(firstAudit.tasks.length, 1);
  assert.equal(store.checkinSessions[0].miss_count, 1);
  assert.equal(missedTask.status, "OPEN");

  const skipped = domain.completeOperationTask(store, missedTask.task_id, { status: "SKIPPED", note: "已电话确认" }).data.task;
  const repeatedAudit = domain.runDailyAudit(store, "2026-04-27").data;

  assert.equal(skipped.status, "SKIPPED");
  assert.equal(store.checkinSessions[0].miss_count, 1);
  assert.equal(repeatedAudit.tasks.length, 0);
  assert.equal(store.operationTasks.filter((task) => task.task_type === "MISSED_CHECKIN").length, 1);
  assert.equal(store.operationTasks.some((task) => task.task_type === "MISSED_CHECKIN" && task.status === "OPEN"), false);
});

test("daily audit adds questionnaire and refund work items to operations summary", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);
  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "yes", needsContact: false },
    idempotencyKey: "day8-audit",
  });

  const audit = domain.runDailyAudit(store, "2026-05-03").data;
  const dashboard = domain.adminDashboard(store).data;

  assert.equal(audit.summary.refundPending, 1);
  assert.equal(audit.summary.day4Pending, 1);
  assert.equal(store.operationTasks.some((task) => task.task_type === "REFUND_PENDING"), true);
  assert.equal(dashboard.summary.date, "2026-05-03");
  assert.equal(dashboard.operationTasks.some((task) => task.taskType === "REFUND_PENDING" && task.user), true);
});

test("admin ops dashboard summarizes operator metrics and prioritized tasks", () => {
  const store = domain.createStore();
  const manualToken = register(store, "13800000888");
  assert.throws(() => domain.startCheckin(store, manualToken, { confirmReceived: true }, "2026-04-26"), /请先匹配/);

  const readyToken = register(store, "13800000002");
  domain.matchOrder(store, readyToken, { phone: "13800000002" }, "2026-04-26");
  domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27");

  const feedbackToken = register(store, "13800000001");
  startMatchedCheckin(store, feedbackToken);
  domain.submitCheckin(
    store,
    feedbackToken,
    { dayIndex: 1, tookProduct: true, hadStool: true, stoolType: "type7", feedback: "今天不太舒服" },
    "2026-04-26"
  );
  domain.syncManualOrder(store, {
    youzanOrderNo: "YZROOT202605240001",
    receiverName: "待匹配用户",
    receiverPhone: "13800009991",
    productName: "ROOT 7日试饮装",
    amount: 199,
    orderStatus: "PAID",
    deliveryStatus: "SHIPPED",
  });

  const dashboard = domain.adminDashboard(store).data.opsDashboard;
  const metrics = Object.fromEntries(dashboard.metrics.map((item) => [item.key, item.value]));

  assert.equal(metrics.pendingOrders, 1);
  assert.equal(metrics.readyToStart, 1);
  assert.equal(metrics.riskFeedbacks, 1);
  assert.equal(dashboard.priorityTasks[0].taskType, "MANUAL_REVIEW_REQUIRED");
  assert.equal(dashboard.priorityTasks[0].label, "需要人工确认");
  assert.equal(dashboard.pendingOrders[0].youzanOrderNo, "YZROOT202605240001");
  assert.equal(dashboard.readyToStartUsers[0].order.orderId, "ord_root_002");
  assert.equal(dashboard.riskFeedbacks[0].title, "Day1 打卡反馈");
});

test("admin order matching searches candidates and previews a clean match", () => {
  const store = domain.createStore();
  const token = register(store, "13800000001");
  const userId = domain.getUserState(store, token).data.user.userId;

  const search = domain.searchAdminOrderMatching(store, { q: "13800000001" }).data;
  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId }).data;
  const confirmed = domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }, "2026-04-28").data;

  assert.equal(search.orders.some((order) => order.youzanOrderNo === "YZROOT202604260001"), true);
  assert.equal(search.users.some((user) => user.userId === userId), true);
  assert.equal(preview.risks.length, 0);
  assert.equal(preview.canConfirm, true);
  assert.equal(confirmed.order.userId, userId);
  assert.equal(confirmed.order.matchSource, "ADMIN_MANUAL_MATCH");
  assert.equal(confirmed.task.task_type, "DELIVERED_NOT_STARTED");
});

test("admin order matching requires risk confirmation for phone mismatch", () => {
  const store = domain.createStore();
  const token = register(store, "13800000003");
  const userId = domain.getUserState(store, token).data.user.userId;

  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId }).data;

  assert.equal(preview.risks.some((item) => item.type === "PHONE_MISMATCH"), true);
  assert.equal(preview.requiresSecondConfirm, true);
  assert.throws(() => domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }), /请先确认风险提示/);

  const confirmed = domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId, confirmRisks: true }, "2026-04-28").data;
  assert.equal(confirmed.success, true);
  assert.equal(confirmed.order.userId, userId);
});

test("admin order matching protects order rebind with note", () => {
  const store = domain.createStore();
  const firstToken = register(store, "13800000001");
  const firstUserId = domain.getUserState(store, firstToken).data.user.userId;
  domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId: firstUserId }, "2026-04-28");

  const secondToken = register(store, "13800000003");
  const secondUserId = domain.getUserState(store, secondToken).data.user.userId;
  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId: secondUserId }).data;

  assert.equal(preview.canConfirm, false);
  assert.equal(preview.risks.some((item) => item.type === "ORDER_BOUND_TO_OTHER_USER"), true);
  assert.throws(
    () => domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId: secondUserId, confirmRisks: true }),
    /确认改绑必须/
  );

  const confirmed = domain.confirmAdminOrderMatch(store, {
    orderId: "ord_root_001",
    userId: secondUserId,
    confirmRisks: true,
    confirmRebind: true,
    note: "用户提供新手机号凭证",
  }, "2026-04-28").data;
  assert.equal(confirmed.order.userId, secondUserId);
  assert.equal(store.youzanOrders.find((order) => order.order_id === "ord_root_001").user_id, secondUserId);
});

test("admin order matching creates exception task after matching abnormal fulfillment", () => {
  const store = domain.createStore();
  const token = register(store, "13800000999");
  const userId = domain.getUserState(store, token).data.user.userId;
  domain.syncManualOrder(store, {
    youzanOrderNo: "YZROOT202605240999",
    receiverName: "异常用户",
    receiverPhone: "13800000999",
    amount: 199,
    deliveryStatus: "EXCEPTION",
  });

  const preview = domain.previewAdminOrderMatch(store, { youzanOrderNo: "YZROOT202605240999", userId }).data;
  const confirmed = domain.confirmAdminOrderMatch(store, {
    youzanOrderNo: "YZROOT202605240999",
    userId,
    confirmRisks: true,
  }, "2026-05-24").data;

  assert.equal(preview.risks.some((item) => item.type === "FULFILLMENT_EXCEPTION"), true);
  assert.equal(confirmed.task.task_type, "FULFILLMENT_EXCEPTION");
});

test("admin user rows expose operator status and blockage summary", () => {
  const store = domain.createStore();
  const token = register(store, "13800000001");
  const userId = domain.getUserState(store, token).data.user.userId;
  domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }, "2026-04-28");

  const dashboard = domain.adminDashboard(store).data;
  const row = dashboard.opsUsers.find((item) => item.userId === userId);
  const detail = domain.getAdminUserDetail(store, userId).data;

  assert.equal(row.currentBlockage, "已送达未开始");
  assert.equal(row.nextAction, "提醒用户进入小程序开始记录");
  assert.equal(row.orderStatusLabel, "已签收");
  assert.equal(row.totalRecords, 0);
  assert.equal(row.openTaskCount, 1);
  assert.equal(detail.opsSummary.currentBlockage, "已送达未开始");
  assert.equal(detail.opsSummary.latestOrderNo, "YZROOT202604260001");
});

test("admin user detail aggregates feedback and can create follow tasks", () => {
  const store = domain.createStore();
  const token = register(store);
  const userId = domain.getUserState(store, token).data.user.userId;
  startMatchedCheckin(store, token);
  domain.submitCheckin(
    store,
    token,
    { dayIndex: 1, tookProduct: true, hadStool: true, stoolType: "type6", feedback: "今天有点不适" },
    "2026-04-26"
  );

  const detail = domain.getAdminUserDetail(store, userId).data;
  const feedback = detail.feedbacks[0];

  assert.equal(detail.user.userId, userId);
  assert.equal(detail.orders.length, 1);
  assert.equal(detail.records.length, 1);
  assert.equal(detail.opsSummary.currentBlockage, "打卡进行中");
  assert.equal(detail.opsSummary.totalRecords, 1);
  assert.equal(feedback.sourceType, "CHECKIN_RECORD");
  assert.equal(feedback.severity, "HIGH");

  const follow = domain.createFeedbackFollowTask(store, userId, {
    sourceType: feedback.sourceType,
    sourceId: feedback.sourceId,
    reason: feedback.text,
  }, "2026-04-27").data;
  const repeated = domain.createFeedbackFollowTask(store, userId, {
    sourceType: feedback.sourceType,
    sourceId: feedback.sourceId,
    reason: feedback.text,
  }, "2026-04-27").data;
  const nextDetail = domain.getAdminUserDetail(store, userId).data;

  assert.equal(follow.task.taskType, "FEEDBACK_FOLLOW");
  assert.equal(follow.created, true);
  assert.equal(repeated.created, false);
  assert.equal(nextDetail.operationTasks.some((task) => task.taskType === "FEEDBACK_FOLLOW"), true);
});

test("Day6 coupon can be claimed without blocking Day7 or refund eligibility", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 5; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    );
  }
  const beforeDay6 = domain.getCouponStatus(store, token).data;
  const day6 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 6, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 6" },
    "2026-05-01"
  ).data;
  const claimed = domain.claimCoupon(store, token, { couponId: day6.coupon.couponId }).data.coupon;
  const day7 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 7, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 7" },
    "2026-05-02"
  ).data;

  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "maybe", needsContact: false },
    idempotencyKey: "day8-coupon-refund",
  });
  const refund = domain.applyRefund(store, token).data.refundWorkItem;

  assert.equal(beforeDay6.coupon, null);
  assert.equal(day6.coupon.visible, true);
  assert.equal(day6.coupon.status, "ISSUED");
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(day7.nextAction, "DAY8_QUESTIONNAIRE");
  assert.equal(refund.status, "PENDING");
});

test("claimed unused coupons create operation tasks and can be marked used", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 6; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    );
  }
  const couponStatus = domain.getCouponStatus(store, token).data.coupon;
  domain.claimCoupon(store, token, { couponId: couponStatus.couponId });
  const audit = domain.runDailyAudit(store, "2026-05-02").data;
  const task = store.operationTasks.find((item) => item.task_type === "COUPON_UNUSED");
  const used = domain.markCouponUsed(store, couponStatus.couponId).data.coupon;

  assert.equal(audit.summary.couponUnused, 1);
  assert.equal(task.status, "DONE");
  assert.equal(task.result, "COUPON_USED");
  assert.equal(used.status, "USED");
});

test("paid refund transitions completed users into daily check-in mode", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);
  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "yes", needsContact: false },
    idempotencyKey: "day8-paid",
  });

  const refund = domain.applyRefund(store, token).data.refundWorkItem;
  domain.approveRefund(store, refund.refund_work_item_id);
  const state = domain.getUserState(store, token).data.user;
  const statsBefore = domain.dailyStats(store, token, "2026-05-03").data;
  const daily = domain.submitDailyCheckin(
    store,
    token,
    { tookProduct: true, hadStool: true, stoolType: "type4", feedback: "继续记录" },
    "2026-05-03"
  ).data;

  assert.equal(state.state, domain.STATES.DAILY_USER);
  assert.equal(statsBefore.totalDays, 7);
  assert.equal(daily.stats.totalDays, 8);
  assert.equal(daily.stats.currentStreak, 8);
});

test("production phone login requires WeChat server credentials", async () => {
  const store = domain.createStore();
  await assert.rejects(
    () => domain.loginWithWechat(store, { wxCode: "wx_code", phoneCode: "phone_code" }),
    /服务端未配置微信登录密钥/
  );
});
