#!/usr/bin/env node
/**
 * Package Linux builds without relying on Electron Forge or Electron Packager.
 *
 * Forge/Packager currently start the Linux package step in CI but do not
 * materialize out/. This script assembles the Electron app directory directly:
 * download Electron, extract it, pack our staged app.asar, copy Codex resources,
 * then let ensure-linux-artifact.js zip and verify the result.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { download } = require("@electron/get");
const extract = require("extract-zip");

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

function copyPlain(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyPlain(source, target);
    } else if (!entry.isSymbolicLink()) {
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}

function stageAppSource(stageDir) {
  fs.mkdirSync(stageDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(stageDir, "package.json"));

  let copied = 1;
  for (const rel of [".vite/build", "webview", "skills", "native-menu-locales", "node_modules"]) {
    const source = path.join(SRC, rel);
    if (fs.existsSync(source)) {
      copied += copyPlain(source, path.join(stageDir, "src", rel));
    }
  }
  return copied;
}

function packAsar(stageDir, dest) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, [
    "asar",
    "pack",
    stageDir,
    dest,
    "--unpack",
    "{**/*.node,**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}",
  ], { cwd: ROOT, stdio: "inherit" });

  if (!fs.existsSync(dest)) {
    throw new Error(`ASAR pack completed but did not create ${dest}`);
  }
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
  const appDir = path.join(OUT, `Codex-linux-${arch}`);
  const zipPath = await download(electronVersion, { platform: "linux", arch });

  console.log(`[linux-package] extracting Electron ${electronVersion} linux/${arch}`);
  fs.mkdirSync(appDir, { recursive: true });
  await extract(zipPath, { dir: appDir });

  const electronBin = path.join(appDir, "electron");
  const codexBin = path.join(appDir, "Codex");
  if (!fs.existsSync(electronBin)) {
    throw new Error(`Electron binary missing after extract: ${electronBin}`);
  }
  fs.renameSync(electronBin, codexBin);
  fs.chmodSync(codexBin, 0o755);

  const resourcesDir = path.join(appDir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Packaged resources directory missing: ${resourcesDir}`);
  }

  fs.rmSync(path.join(resourcesDir, "default_app.asar"), { force: true });
  fs.rmSync(path.join(resourcesDir, "default_app"), { recursive: true, force: true });

  const appStage = fs.mkdtempSync(path.join(os.tmpdir(), "codex-linux-app-"));
  const staged = stageAppSource(appStage);
  const asarPath = path.join(resourcesDir, "app.asar");
  try {
    packAsar(appStage, asarPath);
  } finally {
    fs.rmSync(appStage, { recursive: true, force: true });
  }

  const copied = copyDir(platformDir, resourcesDir);
  for (const executable of ["codex", "rg"]) {
    const full = path.join(resourcesDir, executable);
    if (fs.existsSync(full)) fs.chmodSync(full, 0o755);
  }

  console.log(`[linux-package] ${path.relative(ROOT, appDir)} ready (${staged} app files staged, ${copied} resource files copied)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
