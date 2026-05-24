CREATE TABLE root_store_snapshot (
  store_key VARCHAR(64) PRIMARY KEY,
  schema_version INT NOT NULL,
  payload_json JSON NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE user (
  user_id VARCHAR(32) PRIMARY KEY,
  openid VARCHAR(64) NOT NULL UNIQUE,
  unionid VARCHAR(64),
  phone VARCHAR(16) NOT NULL UNIQUE,
  nickname VARCHAR(64),
  avatar_url VARCHAR(255),
  state VARCHAR(24) NOT NULL,
  created_at DATETIME NOT NULL,
  registered_at DATETIME,
  activated_at DATETIME,
  completed_at DATETIME,
  total_checkin_days INT NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  longest_streak INT NOT NULL DEFAULT 0,
  last_checkin_date DATE
);

CREATE TABLE user_profile (
  profile_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL UNIQUE,
  join_reasons JSON NOT NULL,
  gut_health_status VARCHAR(24) NOT NULL,
  improvement_methods JSON NOT NULL,
  stool_type VARCHAR(12) NOT NULL,
  submitted_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE lead_profile (
  lead_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  source_channel VARCHAR(48),
  offline_event_name VARCHAR(64),
  corp_wechat_status VARCHAR(24) NOT NULL,
  rule_sent_at DATETIME,
  operator_note TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE identity_link (
  identity_link_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  receiver_phone VARCHAR(16) NOT NULL,
  external_contact_id VARCHAR(64),
  wechat_remark_name VARCHAR(64),
  match_confidence VARCHAR(16) NOT NULL,
  warnings JSON,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE youzan_order (
  order_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32),
  youzan_order_no VARCHAR(64) NOT NULL UNIQUE,
  phone VARCHAR(16) NOT NULL,
  receiver_name VARCHAR(64),
  receiver_phone VARCHAR(16),
  product_name VARCHAR(64),
  product_id VARCHAR(32) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  paid_at DATETIME,
  order_status VARCHAR(24) NOT NULL DEFAULT 'PAID',
  delivery_status VARCHAR(16) NOT NULL,
  raw_address_text TEXT,
  matched_at DATETIME,
  match_source VARCHAR(24),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE order_fulfillment (
  fulfillment_id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL UNIQUE,
  receiver_name VARCHAR(64),
  receiver_phone VARCHAR(16),
  carrier VARCHAR(32),
  tracking_no VARCHAR(64),
  delivery_status VARCHAR(16) NOT NULL,
  shipped_at DATETIME,
  delivered_at DATETIME,
  last_event_text TEXT,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE operation_task (
  task_id VARCHAR(32) PRIMARY KEY,
  task_type VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  order_id VARCHAR(32),
  task_date DATE NOT NULL,
  dedupe_key VARCHAR(96),
  status VARCHAR(16) NOT NULL,
  reason TEXT,
  suggested_action TEXT,
  suggested_script TEXT,
  metadata JSON,
  created_at DATETIME NOT NULL,
  completed_at DATETIME,
  result TEXT,
  note TEXT,
  UNIQUE (task_type, user_id, order_id, task_date, dedupe_key),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE daily_summary (
  date DATE PRIMARY KEY,
  active_sessions INT NOT NULL,
  completed_sessions INT NOT NULL,
  failed_sessions INT NOT NULL,
  due_today INT NOT NULL,
  checked_today INT NOT NULL,
  missed_today INT NOT NULL,
  day4_pending INT NOT NULL,
  day8_pending INT NOT NULL,
  refund_pending INT NOT NULL,
  coupon_unused INT NOT NULL,
  open_tasks INT NOT NULL,
  generated_tasks INT NOT NULL,
  audited_at DATETIME NOT NULL
);

CREATE TABLE checkin_session (
  session_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL,
  miss_count INT NOT NULL DEFAULT 0,
  audited_miss_days JSON,
  refund_status VARCHAR(16),
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE checkin_record (
  record_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  day_index INT NOT NULL,
  checkin_date DATE NOT NULL,
  took_product BOOLEAN NOT NULL,
  had_stool BOOLEAN NOT NULL,
  stool_type VARCHAR(12),
  feedback TEXT,
  image_urls JSON,
  checked_in_at DATETIME NOT NULL,
  is_makeup BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (session_id, day_index),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);

CREATE TABLE questionnaire_definition (
  questionnaire_type VARCHAR(32) NOT NULL,
  version INT NOT NULL,
  questions JSON NOT NULL,
  required_fields JSON NOT NULL,
  skip_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (questionnaire_type, version)
);

CREATE TABLE questionnaire_response (
  response_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  questionnaire_type VARCHAR(32) NOT NULL,
  version INT NOT NULL,
  answers JSON NOT NULL,
  submitted_at DATETIME NOT NULL,
  needs_follow BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key VARCHAR(64),
  UNIQUE (user_id, session_id, questionnaire_type),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id)
);

CREATE TABLE refund_work_item (
  refund_work_item_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL UNIQUE,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  youzan_order_no VARCHAR(64) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  paid_at DATETIME,
  note TEXT,
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE coupon_event (
  coupon_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32),
  coupon_type VARCHAR(32) NOT NULL,
  experiment_group VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason VARCHAR(48),
  title VARCHAR(64),
  description TEXT,
  discount_text VARCHAR(64),
  code VARCHAR(32),
  issued_at DATETIME,
  claimed_at DATETIME,
  used_at DATETIME,
  expires_at DATE,
  repurchase_clicked_at DATETIME,
  created_at DATETIME NOT NULL,
  UNIQUE (session_id, coupon_type),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE refund (
  refund_id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  order_id VARCHAR(32) NOT NULL,
  youzan_order_no VARCHAR(64) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  paid_at DATETIME,
  FOREIGN KEY (session_id) REFERENCES checkin_session(session_id),
  FOREIGN KEY (user_id) REFERENCES user(user_id),
  FOREIGN KEY (order_id) REFERENCES youzan_order(order_id)
);

CREATE TABLE daily_checkin_record (
  record_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  checkin_date DATE NOT NULL,
  took_product BOOLEAN NOT NULL,
  had_stool BOOLEAN NOT NULL,
  stool_type VARCHAR(12),
  feedback TEXT,
  checked_in_at DATETIME NOT NULL,
  streak_count INT NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE (user_id, checkin_date),
  FOREIGN KEY (user_id) REFERENCES user(user_id)
);
