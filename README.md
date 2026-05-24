# ROOT 7日打卡后台

轻量 Node.js 后台，无外部依赖，便于先跑通 ROOT 试饮流程和 HTTP Interface。默认使用内存数据仓库；设置 `ROOT_STORE_FILE` 后可切到 JSON 文件 Adapter，用于灰度试跑和重启后保留本地数据；设置 `ROOT_SQLITE_FILE` 后可切到 SQLite Adapter，用于单实例小范围上线前验证。

## 常用命令

```bash
npm run dev
npm test
```

微信云托管快速部署时，选择 Express.js 模板即可；真正部署本项目时请把代码源替换为本目录 `backend/`，不要继续使用 `WeixinCloud/wxcloudrun-express` 示例仓库。本目录已包含 `Dockerfile`，容器默认监听 `80` 端口。

本地后台启动后，可以生成发布校准报告：

```bash
npm run calibrate -- --base-url http://127.0.0.1:8788 --target gray
npm run calibrate -- --base-url http://127.0.0.1:8788 --target production --strict
```

拿到真实导出文件后，可以批量跑样本准入：

```bash
npm run samples -- --base-url http://127.0.0.1:8788 --mode preview --youzan-file ./samples/youzan.csv
npm run samples -- --base-url http://127.0.0.1:8788 --mode import --youzan-file ./samples/youzan.csv --fulfillment-file ./samples/fulfillment.csv --wework-file ./samples/wework.csv --require-all-ready
```

真实 Adapter 配置好后，可以先小批量运行：

```bash
npm run adapters -- --base-url http://127.0.0.1:8788 --source youzan --mode preview --limit 1
npm run adapters -- --base-url http://127.0.0.1:8788 --source fulfillment --mode import --limit 1
npm run adapters -- --base-url http://127.0.0.1:8788 --source wework --mode preview --limit 1
```

本地灰度试跑需要保留数据时：

```bash
ROOT_STORE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/dev-store.json npm run dev
```

需要用 SQL 文件承载数据时：

```bash
ROOT_SQLITE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/root-checkin.sqlite npm run dev
```

## 生产环境变量

```bash
PORT=8787
WECHAT_APPID=正式小程序 AppID
WECHAT_APPSECRET=正式小程序 AppSecret
ROOT_PUBLIC_BASE_URL=https://api.your-domain.example
ROOT_SQLITE_FILE=/var/lib/root-checkin/root-checkin.sqlite
YOUZAN_CLIENT_ID=有赞应用 client id
YOUZAN_CLIENT_SECRET=有赞应用 client secret
YOUZAN_ACCESS_TOKEN=有赞访问 token
YOUZAN_ORDER_LIST_URL=https://example.com/youzan/order/list
YOUZAN_ORDER_LIST_METHOD=POST
YOUZAN_ORDER_LIST_DATA_PATH=data.items
YOUZAN_ORDER_LIST_CURSOR_PATH=data.nextCursor
YOUZAN_ORDER_FIELD_MAP={"youzanOrderNo":"tid","receiverPhone":"receiver_tel"}
ROOT_FULFILLMENT_SECRET=物流推送或拉取密钥
ROOT_FULFILLMENT_LIST_URL=https://example.com/fulfillment/events
ROOT_FULFILLMENT_LIST_METHOD=POST
ROOT_FULFILLMENT_LIST_DATA_PATH=data.events
ROOT_FULFILLMENT_LIST_CURSOR_PATH=data.nextCursor
ROOT_FULFILLMENT_FIELD_MAP={"youzanOrderNo":"order_no","deliveryStatus":"logistics_status"}
WEWORK_CORP_ID=企业微信 corp id
WEWORK_CONTACT_SECRET=企业微信客户联系 secret
WEWORK_ACCESS_TOKEN=企业微信访问 token
WEWORK_CONTACT_LIST_URL=https://example.com/wework/external-contacts
WEWORK_CONTACT_LIST_METHOD=POST
WEWORK_CONTACT_LIST_DATA_PATH=data.contacts
WEWORK_CONTACT_LIST_CURSOR_PATH=data.nextCursor
WEWORK_CONTACT_FIELD_MAP={"externalContactId":"external_userid","remarkName":"remark","receiverPhone":"mobile"}
```

正式环境登录会使用 `wx.login` 和 `getPhoneNumber` 返回的 code，到微信服务端换取 openid 和手机号。未配置 `WECHAT_APPID` / `WECHAT_APPSECRET` 时，正式手机号登录会拒绝执行，避免无授权手机号进入。

`ROOT_STORE_FILE` 是可选项：不设置时使用内存 Adapter；设置后每次 HTTP Interface 请求结束会保存到该 JSON 文件。JSON 文件 Adapter 只建议用于内部灰度和运营试跑。

`ROOT_SQLITE_FILE` 优先级高于 `ROOT_STORE_FILE`。SQLite Adapter 使用事务把当前 Store Interface 的整块数据保存到 `root_store_snapshot`，适合单实例小范围上线前验证；后续并发量或多实例部署上来后，再迁移到 PostgreSQL/MySQL Adapter。

真实平台 Adapter 目前先开放 `MANUAL_SAMPLE` Adapter：运营粘贴有赞、物流、企业微信导出样本即可走同一套预览、导入、评审和准入 Interface。有赞开放平台、物流推送、企业微信客户联系 Adapter 已在后台展示配置状态；凭证和平台请求方式补齐后，只替换对应 Adapter 的 Implementation。真实 Adapter 成功导入后会保存增量游标；缺配置、缺 Implementation 或运行失败都会记录在 Adapter 运行台账里。

有赞订单已提供可配置 HTTP Implementation：设置 `YOUZAN_ACCESS_TOKEN` 与 `YOUZAN_ORDER_LIST_URL` 后，`YOUZAN_OPEN` Adapter 会进入 `READY`。不同有赞返回结构可通过 `YOUZAN_ORDER_LIST_DATA_PATH`、`YOUZAN_ORDER_LIST_CURSOR_PATH`、`YOUZAN_ORDER_LIST_HAS_MORE_PATH` 和 `YOUZAN_ORDER_FIELD_MAP` 对齐，不需要改订单导入 Interface。

物流状态也已提供可配置 HTTP Implementation：设置 `ROOT_FULFILLMENT_SECRET` 与 `ROOT_FULFILLMENT_LIST_URL` 后，`FULFILLMENT_PUSH` Adapter 会进入 `READY`。不同物流返回结构可通过 `ROOT_FULFILLMENT_LIST_DATA_PATH`、`ROOT_FULFILLMENT_LIST_CURSOR_PATH`、`ROOT_FULFILLMENT_LIST_HAS_MORE_PATH` 和 `ROOT_FULFILLMENT_FIELD_MAP` 对齐；密钥可通过 header、query 或 body 传递。

企业微信线索已提供可配置 HTTP Implementation：设置 `WEWORK_CONTACT_LIST_URL`，并配置 `WEWORK_ACCESS_TOKEN` 或 `WEWORK_CONTACT_SECRET` 后，`WEWORK_CONTACT` Adapter 会进入 `READY`。不同企业微信返回结构可通过 `WEWORK_CONTACT_LIST_DATA_PATH`、`WEWORK_CONTACT_LIST_CURSOR_PATH`、`WEWORK_CONTACT_LIST_HAS_MORE_PATH` 和 `WEWORK_CONTACT_FIELD_MAP` 对齐；无法匹配用户的线索会继续进入人工匹配待办。

发布记录 Module 会通过 `GET /api/v1/admin/release-record` 汇总上线闸口、Adapter 校准、最近 Adapter 运行、数据仓库 Adapter、环境变量存在性、签字位和回滚动作。管理台的“发布记录”面板可直接作为灰度/上线评审时的决策凭证。

## 主要 HTTP Interface 路径

- `POST /api/v1/auth/login`
- `GET /api/v1/user/state`
- `POST /api/v1/user/profile`
- `POST /api/v1/order/match`
- `POST /api/v1/checkin/start`
- `GET /api/v1/checkin/session`
- `POST /api/v1/checkin/submit`
- `GET /api/v1/checkin/records`
- `POST /api/v1/refund/apply`
- `GET /api/v1/refund/status`
- `GET /api/v1/coupon/status`
- `POST /api/v1/coupon/claim`
- `POST /api/v1/coupon/repurchase-click`
- `POST /api/v1/user/continue-daily`
- `GET /api/v1/daily/stats`
- `POST /api/v1/daily/submit`
- `GET /api/v1/daily/history`
- `GET /api/v1/daily/trend`
- `POST /api/v1/event/track`
- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/launch-readiness`
- `GET /api/v1/admin/adapter-calibration`
- `GET /api/v1/admin/release-record`
- `GET /api/v1/admin/tasks`
- `GET /api/v1/admin/users/:userId/detail`
- `POST /api/v1/admin/users/:userId/follow`
- `GET /api/v1/admin/external-adapters`
- `POST /api/v1/admin/external-adapters/run`
- `GET /api/v1/admin/external-samples/template`
- `POST /api/v1/admin/external-samples/preview`
- `POST /api/v1/admin/external-samples/import`
- `POST /api/v1/admin/external-status-mappings`
- `POST /api/v1/admin/coupons/:couponId/use`

本地管理台：`/` 或 `/admin`。

注意：默认内存 Adapter 适合联调和演示。JSON 文件 Adapter 可以支撑小范围灰度的重启恢复，但并发、备份、权限和迁移能力都不是正式生产形态。SQLite Adapter 可以作为单实例小范围上线前的生产化过渡；多实例或高并发场景仍建议接入 PostgreSQL/MySQL。
