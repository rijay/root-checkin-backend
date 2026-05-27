const fs = require("node:fs");
const path = require("node:path");

const { mysqlConfigFromEnv, validateSnapshot } = require("../src/store");

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "", filePath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--json") {
      args.mode = "json";
      args.filePath = argv[index + 1] || "";
      index += 1;
    } else if (item === "--sqlite") {
      args.mode = "sqlite";
      args.filePath = argv[index + 1] || "";
      index += 1;
    } else if (item === "--mysql") {
      args.mode = "mysql";
    }
  }
  return args;
}

function readJsonSnapshot(filePath) {
  if (!filePath) throw new Error("--json requires a file path");
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function readSqliteSnapshot(filePath) {
  if (!filePath) throw new Error("--sqlite requires a file path");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.resolve(filePath));
  try {
    const row = db.prepare("SELECT payload_json FROM root_store_snapshot WHERE store_key = ?").get("root-checkin");
    if (!row) throw new Error("SQLite snapshot row not found");
    return JSON.parse(row.payload_json);
  } finally {
    db.close();
  }
}

async function readMysqlSnapshot(env = process.env) {
  const mysql = require("mysql2/promise");
  const config = mysqlConfigFromEnv(env);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    timezone: "+08:00",
  });
  try {
    const [rows] = await connection.execute("SELECT payload_json FROM root_store_snapshot WHERE store_key = ?", ["root-checkin"]);
    if (!rows[0]) throw new Error("MySQL snapshot row not found");
    return JSON.parse(rows[0].payload_json);
  } finally {
    await connection.end();
  }
}

async function loadSnapshot(args) {
  if (args.mode === "json") return readJsonSnapshot(args.filePath);
  if (args.mode === "sqlite") return readSqliteSnapshot(args.filePath);
  if (args.mode === "mysql") return readMysqlSnapshot();
  throw new Error("Usage: node scripts/store-verify.js --json <file> | --sqlite <file> | --mysql");
}

async function main() {
  const args = parseArgs();
  const snapshot = await loadSnapshot(args);
  const report = {
    source: args.mode,
    checkedAt: new Date().toISOString(),
    ...validateSnapshot(snapshot),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  loadSnapshot,
  parseArgs,
  readJsonSnapshot,
  readMysqlSnapshot,
  readSqliteSnapshot,
};
