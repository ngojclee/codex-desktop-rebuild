#!/usr/bin/env node
/**
 * Ensure Linux CI produces at least one downloadable artifact.
 *
 * Electron Forge 7 can package the Linux app successfully while returning
 * before any configured makers write into out/make. The CI upload step then
 * turns green with no files in the manual workflow. This build-time guard keeps
 * the lane honest by zipping the packaged Linux directory when makers produced
 * nothing, then failing if no artifact exists.
 */
const fs = require("fs");
const path = require("path");
const { zipSync } = require("cross-zip");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");
const MAKE = path.join(OUT, "make");

function parseArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function walk(dir, matches = []) {
  if (!fs.existsSync(dir)) return matches;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, matches);
    else if (/\.(deb|rpm|zip)$/i.test(entry.name)) matches.push(full);
  }
  return matches;
}

function listOut() {
  if (!fs.existsSync(OUT)) return "(out/ is missing)";
  return fs.readdirSync(OUT).join(", ") || "(out/ is empty)";
}

function main() {
  const arch = parseArg("arch");
  if (!arch) throw new Error("Usage: ensure-linux-artifact.js --arch <x64|arm64>");

  const existing = walk(MAKE);
  if (existing.length > 0) {
    console.log(`[linux-artifact] maker output exists: ${existing.map((p) => path.relative(ROOT, p)).join(", ")}`);
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const appDir = path.join(OUT, `Codex-linux-${arch}`);
  if (!fs.existsSync(appDir)) {
    throw new Error(`[linux-artifact] no maker output and missing packaged app ${appDir}; out contains: ${listOut()}`);
  }

  for (const required of ["resources/app.asar", "resources/codex", "resources/rg"]) {
    const full = path.join(appDir, ...required.split("/"));
    if (!fs.existsSync(full)) {
      throw new Error(`[linux-artifact] packaged app is incomplete; missing ${required} in ${appDir}`);
    }
  }

  const zipDir = path.join(MAKE, "zip", "linux", arch);
  fs.mkdirSync(zipDir, { recursive: true });

  const zipPath = path.join(zipDir, `Codex-linux-${arch}-${packageJson.version}.zip`);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  zipSync(appDir, zipPath);

  const size = fs.statSync(zipPath).size;
  if (size <= 0) throw new Error(`[linux-artifact] created empty zip: ${zipPath}`);
  console.log(`[linux-artifact] fallback zip: ${path.relative(ROOT, zipPath)} (${Math.round(size / 1024 / 1024)} MB)`);
}

main();
