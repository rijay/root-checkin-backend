const fs = require("node:fs");
const path = require("node:path");

const { createSeedData } = require("./seed");

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STORE_KEY = "root-checkin";
const MYSQL_SCHEMA_VERSION = 1;
const MYSQL_STORE_KEY = "root-checkin";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(target) ? target : clone(defaults);
  if (!defaults || typeof defaults !== "object") return target === undefined ? defaults : target;
  const next = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (next[key] === undefined) {
      next[key] = clone(value);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = mergeDefaults(next[key], value);
    }
  });
  return next;
}

function createEmptyData() {
  const data = createSeedData();
  data.youzanOrders = [];
  data.orderFulfillments = [];
  data.events = [];
  return data;
}

function defaultsForOptions(options = {}) {
  return options.seedSampleData ? createSeedData() : createEmptyData();
}

function normalizeStoreData(rawData, options = {}) {
  return mergeDefaults(rawData || {}, defaultsForOptions(options));
}

function validateSnapshot(snapshot, options = {}) {
  const errors = [];
  const warnings = [];
  const defaults = defaultsForOptions({ seedSampleData: false, ...options });

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      valid: false,
      errors: ["snapshot must be an object"],
      warnings,
      counts: {},
    };
  }

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    const value = snapshot[key];
    if (value === undefined) {
      errors.push(`missing key: ${key}`);
      return;
    }
    if (Array.isArray(defaultValue) && !Array.isArray(value)) {
      errors.push(`key ${key} must be an array`);
      return;
    }
    if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`key ${key} must be an object`);
    }
  });

  const duplicateChecks = [
    ["users", "user_id"],
    ["youzanOrders", "order_id"],
    ["youzanOrders", "youzan_order_no"],
    ["orderFulfillments", "fulfillment_id"],
    ["checkinSessions", "session_id"],
    ["operationTasks", "task_id"],
    ["importBatches", "batch_id"],
    ["auditLogs", "audit_id"],
  ];
  duplicateChecks.forEach(([listKey, idKey]) => {
    const list = snapshot[listKey];
    if (!Array.isArray(list)) return;
    const seen = new Set();
    list.forEach((item) => {
      const id = item && item[idKey];
      if (!id) return;
      if (seen.has(id)) errors.push(`duplicate ${listKey}.${idKey}: ${id}`);
      seen.add(id);
    });
  });

  const orderIds = new Set(Array.isArray(snapshot.youzanOrders) ? snapshot.youzanOrders.map((order) => order.order_id).filter(Boolean) : []);
  if (Array.isArray(snapshot.orderFulfillments)) {
    snapshot.orderFulfillments.forEach((fulfillment) => {
      if (fulfillment.order_id && !orderIds.has(fulfillment.order_id)) {
        warnings.push(`fulfillment references missing order: ${fulfillment.order_id}`);
      }
    });
  }

  const counts = Object.fromEntries(Object.keys(defaults)
    .filter((key) => Array.isArray(snapshot[key]))
    .map((key) => [key, snapshot[key].length]));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
  };
}

function replaceStoreData(target, nextData, options = {}) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, normalizeStoreData(nextData || {}, options));
  return target;
}

function createMemoryStore(initialData, options = { seedSampleData: true }) {
  const data = normalizeStoreData(initialData || defaultsForOptions(options), options);
  return {
    kind: "memory",
    data,
    save() {},
    exportSnapshot() {
      return clone(data);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "memory",
        schemaVersion: null,
        lastSavedAt: "",
        persistent: false,
      };
    },
  };
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function createJsonFileStore(filePath, options = {}) {
  if (!filePath) throw new Error("JSON store path is required");
  const absolutePath = path.resolve(filePath);
  const data = normalizeStoreData(readJsonFile(absolutePath) || defaultsForOptions(options), options);
  let lastSavedAt = "";
  const adapter = {
    kind: "json-file",
    filePath: absolutePath,
    data,
    save() {
      writeJsonFile(absolutePath, data);
      lastSavedAt = new Date().toISOString();
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "json-file",
        filePath: absolutePath,
        schemaVersion: null,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function createSqliteStore(filePath, options = {}) {
  if (!filePath) throw new Error("SQLite store path is required");
  const { DatabaseSync } = require("node:sqlite");
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS root_store_snapshot (
      store_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT payload_json FROM root_store_snapshot WHERE store_key = ?").get(SQLITE_STORE_KEY);
  const data = normalizeStoreData(row ? JSON.parse(row.payload_json) : defaultsForOptions(options), options);
  let lastSavedAt = "";

  const adapter = {
    kind: "sqlite",
    filePath: absolutePath,
    data,
    save() {
      const payload = JSON.stringify(data);
      const updatedAt = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO root_store_snapshot (store_key, schema_version, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(store_key) DO UPDATE SET
            schema_version = excluded.schema_version,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(SQLITE_STORE_KEY, SQLITE_SCHEMA_VERSION, payload, updatedAt);
        db.exec("COMMIT");
        lastSavedAt = updatedAt;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      return adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    close() {
      db.close();
    },
    getStoreHealth() {
      return {
        kind: "sqlite",
        filePath: absolutePath,
        schemaVersion: SQLITE_SCHEMA_VERSION,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function parseMysqlAddress(address = "") {
  const [hostPart, portPart] = String(address || "").split(":");
  return {
    host: hostPart || "127.0.0.1",
    port: Number(portPart || 3306),
  };
}

function mysqlIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`${label} can only contain letters, numbers, and underscores`);
  }
  return `\`${identifier}\``;
}

function mysqlConfigFromEnv(env = process.env) {
  const address = parseMysqlAddress(env.MYSQL_ADDRESS || "");
  return {
    host: env.MYSQL_HOST || address.host,
    port: Number(env.MYSQL_PORT || address.port || 3306),
    user: env.MYSQL_USERNAME || env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE || "root_checkin",
  };
}

async function createMysqlStore(config = {}, options = {}) {
  const mysql = require("mysql2/promise");
  const mergedConfig = {
    ...mysqlConfigFromEnv(),
    ...config,
  };
  const database = mergedConfig.database || "root_checkin";
  const connection = await mysql.createConnection({
    host: mergedConfig.host,
    port: Number(mergedConfig.port || 3306),
    user: mergedConfig.user,
    password: mergedConfig.password,
    charset: "utf8mb4",
    timezone: "+08:00",
    multipleStatements: false,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysqlIdentifier(database, "MYSQL_DATABASE")} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE ${mysqlIdentifier(database, "MYSQL_DATABASE")}`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS root_store_snapshot (
      store_key VARCHAR(128) PRIMARY KEY,
      schema_version INT NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const [rows] = await connection.execute("SELECT payload_json, updated_at FROM root_store_snapshot WHERE store_key = ?", [MYSQL_STORE_KEY]);
  const data = normalizeStoreData(rows[0] ? JSON.parse(rows[0].payload_json) : defaultsForOptions(options), options);
  let lastSavedAt = rows[0] ? rows[0].updated_at : "";
  let saveQueue = Promise.resolve();

  const adapter = {
    kind: "mysql",
    data,
    config: {
      host: mergedConfig.host,
      port: Number(mergedConfig.port || 3306),
      database,
      user: mergedConfig.user,
    },
    save() {
      const payload = JSON.stringify(data);
      const updatedAt = new Date().toISOString();
      saveQueue = saveQueue.then(async () => {
        await connection.execute(
          `
            INSERT INTO root_store_snapshot (store_key, schema_version, payload_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              schema_version = VALUES(schema_version),
              payload_json = VALUES(payload_json),
              updated_at = VALUES(updated_at)
          `,
          [MYSQL_STORE_KEY, MYSQL_SCHEMA_VERSION, payload, updatedAt]
        );
        lastSavedAt = updatedAt;
      });
      return saveQueue;
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      return adapter.save();
    },
    exportSnapshot() {
      return clone(data);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "mysql",
        schemaVersion: MYSQL_SCHEMA_VERSION,
        lastSavedAt,
        persistent: true,
        database,
        host: mergedConfig.host,
        port: Number(mergedConfig.port || 3306),
      };
    },
    async close() {
      await saveQueue;
      await connection.end();
    },
  };
  await adapter.save();
  return adapter;
}

module.exports = {
  createJsonFileStore,
  createEmptyData,
  createMemoryStore,
  createMysqlStore,
  createSqliteStore,
  mysqlConfigFromEnv,
  normalizeStoreData,
  validateSnapshot,
};
