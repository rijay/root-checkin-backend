const fs = require("node:fs");
const path = require("node:path");

const { createSeedData } = require("./seed");

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STORE_KEY = "root-checkin";

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

function createMemoryStore(initialData, options = { seedSampleData: true }) {
  return {
    kind: "memory",
    data: normalizeStoreData(initialData || defaultsForOptions(options), options),
    save() {},
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
  const adapter = {
    kind: "json-file",
    filePath: absolutePath,
    data,
    save() {
      writeJsonFile(absolutePath, data);
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
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
  adapter.save();
  return adapter;
}

module.exports = {
  createJsonFileStore,
  createEmptyData,
  createMemoryStore,
  createSqliteStore,
  normalizeStoreData,
};
