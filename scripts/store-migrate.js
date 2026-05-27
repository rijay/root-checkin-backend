const { createMysqlStore, mysqlConfigFromEnv, validateSnapshot } = require("../src/store");
const { loadSnapshot, parseArgs: parseVerifyArgs } = require("./store-verify");

function parseArgs(argv = process.argv.slice(2)) {
  const args = parseVerifyArgs(argv);
  args.dryRun = argv.includes("--dry-run");
  return args;
}

async function main() {
  const args = parseArgs();
  if (args.mode === "mysql") throw new Error("source must be --json or --sqlite when migrating to MySQL");
  const snapshot = await loadSnapshot(args);
  const sourceReport = validateSnapshot(snapshot);
  if (!sourceReport.valid) {
    console.log(JSON.stringify({ source: args.mode, target: "mysql", dryRun: args.dryRun, ...sourceReport }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      source: args.mode,
      target: "mysql",
      dryRun: true,
      readyToWrite: true,
      counts: sourceReport.counts,
      warnings: sourceReport.warnings,
    }, null, 2));
    return;
  }

  const adapter = await createMysqlStore(mysqlConfigFromEnv(process.env), { seedSampleData: false });
  try {
    await adapter.importSnapshot(snapshot);
    const targetReport = adapter.validateSnapshot();
    console.log(JSON.stringify({
      source: args.mode,
      target: "mysql",
      dryRun: false,
      written: targetReport.valid,
      health: adapter.getStoreHealth(),
      ...targetReport,
    }, null, 2));
    if (!targetReport.valid) process.exitCode = 1;
  } finally {
    await adapter.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
};
