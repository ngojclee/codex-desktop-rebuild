#!/usr/bin/env node
/**
 * Package Linux builds without relying on Electron Forge makers.
 *
 * Forge is still used for macOS and Windows, but the Linux lane can currently
 * resolve makers and then exit without writing out/. Calling @electron/packager
 * directly gives us a deterministic packaged app directory, after which
 * ensure-linux-artifact.js creates the release zip.
 */
const fs = require("fs");
const path = require("path");
const { packager } = require("@electron/packager");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "out");

const MACOS_ONLY_FILES = new Set([
  "node",
  "node_repl",
  "electron.icns",
  "Assets.car",
  "codexTemplate.png",
  "codexTemplate@2x.png",
  "app.asar",
  "codex-notification.wav",
]);
const MACOS_ONLY_DIRS = new Set(["native", "app.asar.unpacked"]);

function parseArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.endsWith(".lproj")) continue;
    if (MACOS_ONLY_FILES.has(entry.name) || MACOS_ONLY_DIRS.has(entry.name)) continue;

    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyDir(source, target);
    } else if (!entry.isSymbolicLink()) {
      fs.copyFileSync(source, target);
      try { fs.chmodSync(target, 0o755); } catch {}
      copied += 1;
    }
  }
  return copied;
}

function linuxIgnore(filePath) {
  if (filePath === "") return false;
  if (filePath === "/package.json") return false;
  const allowed = ["/src/.vite/build", "/src/webview", "/src/skills", "/src/native-menu-locales", "/src/node_modules"];
  for (const allowedPath of allowed) {
    if (allowedPath.startsWith(filePath) || filePath.startsWith(allowedPath)) return false;
  }
  return true;
}

async function main() {
  const arch = parseArg("arch");
  if (!["x64", "arm64"].includes(arch)) {
    throw new Error("Usage: package-linux.js --arch <x64|arm64>");
  }

  const platformDir = path.join(SRC, arch === "arm64" ? "mac-arm64" : "mac-x64");
  if (!fs.existsSync(platformDir)) {
    throw new Error(`Missing source resources: ${path.relative(ROOT, platformDir)}`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });

  const electronVersion = require("electron/package.json").version;
  const outputPaths = await packager({
    dir: ROOT,
    out: OUT,
    overwrite: true,
    platform: "linux",
    arch,
    name: "Codex",
    executableName: "Codex",
    icon: path.join(ROOT, "resources", "electron"),
    electronVersion,
    asar: { unpack: "{**/*.node,**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}" },
    ignore: linuxIgnore,
    prune: true,
    quiet: false,
  });

  const appDir = outputPaths[0] || path.join(OUT, `Codex-linux-${arch}`);
  const resourcesDir = path.join(appDir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Packaged resources directory missing: ${resourcesDir}`);
  }

  const copied = copyDir(platformDir, resourcesDir);
  for (const executable of ["codex", "rg"]) {
    const full = path.join(resourcesDir, executable);
    if (fs.existsSync(full)) fs.chmodSync(full, 0o755);
  }

  console.log(`[linux-package] ${path.relative(ROOT, appDir)} ready (${copied} resource files copied)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
