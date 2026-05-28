const { createApp } = require("./app");
const { createJsonFileStore, createMysqlStore, createSqliteStore, mysqlConfigFromEnv } = require("./store");

const port = Number(process.env.PORT || 8787);

function shouldUseMysql(env = process.env) {
  if (env.ROOT_STORE_ADAPTER === "mysql") return true;
  if (env.ROOT_STORE_ADAPTER) return false;
  return Boolean(env.MYSQL_ADDRESS && env.MYSQL_USERNAME && env.MYSQL_PASSWORD);
}

async function createConfiguredStore(env = process.env) {
  if (shouldUseMysql(env)) return createMysqlStore(mysqlConfigFromEnv(env));
  if (env.ROOT_STORE_ADAPTER === "sqlite" || env.ROOT_SQLITE_FILE) {
    return createSqliteStore(env.ROOT_SQLITE_FILE || "./data/root-checkin.sqlite");
  }
  if (env.ROOT_STORE_ADAPTER === "json-file" || env.ROOT_STORE_FILE) {
    return createJsonFileStore(env.ROOT_STORE_FILE || "./data/root-checkin.json");
  }
  return undefined;
}

async function main() {
  const storeAdapter = await createConfiguredStore(process.env);
  const server = createApp({ storeAdapter });
  server.listen(port, "0.0.0.0", () => {
    const storeHealth = server.storeAdapter.getStoreHealth ? server.storeAdapter.getStoreHealth() : { kind: server.storeAdapter.kind };
    const storeTarget = server.storeAdapter.filePath
      ? ` (${server.storeAdapter.filePath})`
      : storeHealth.database
        ? ` (${storeHealth.host}:${storeHealth.port}/${storeHealth.database})`
        : "";
    console.log(`ROOT check-in backend listening on http://127.0.0.1:${port}`);
    console.log(`Admin console: http://127.0.0.1:${port}`);
    console.log(`Store adapter: ${server.storeAdapter.kind}${storeTarget}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to start ROOT check-in backend:", error);
    process.exit(1);
  });
}

module.exports = {
  createConfiguredStore,
  shouldUseMysql,
};
