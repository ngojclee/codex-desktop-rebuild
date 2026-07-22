const os = require("os");
const path = require("path");

function getSyncTempDir() {
  if (process.env.CODEX_SYNC_TEMP_DIR) {
    return path.resolve(process.env.CODEX_SYNC_TEMP_DIR);
  }

  // Deep app.asar.unpacked paths can reach the legacy Windows MAX_PATH
  // boundary under the normal user temp directory. GitHub's RUNNER_TEMP is
  // shorter; keep the fallback directory name short for local Windows builds.
  const baseDir =
    process.platform === "win32" && process.env.RUNNER_TEMP
      ? process.env.RUNNER_TEMP
      : os.tmpdir();

  return path.join(baseDir, "cx");
}

module.exports = { getSyncTempDir };
