const { createApp } = require("./app");
const { createJsonFileStore, createSqliteStore } = require("./store");

const port = Number(process.env.PORT || 8787);
const storeAdapter = process.env.ROOT_SQLITE_FILE
  ? createSqliteStore(process.env.ROOT_SQLITE_FILE)
  : process.env.ROOT_STORE_FILE
    ? createJsonFileStore(process.env.ROOT_STORE_FILE)
    : undefined;
const server = createApp({ storeAdapter });

server.listen(port, "0.0.0.0", () => {
  console.log(`ROOT check-in backend listening on http://127.0.0.1:${port}`);
  console.log(`Admin console: http://127.0.0.1:${port}`);
  console.log(`Store adapter: ${server.storeAdapter.kind}${server.storeAdapter.filePath ? ` (${server.storeAdapter.filePath})` : ""}`);
});
