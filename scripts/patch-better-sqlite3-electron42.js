#!/usr/bin/env node
/**
 * Patch better-sqlite3 native sources for Electron 42 / V8 14.8.
 *
 * Electron 42 headers require an ExternalPointerTypeTag for v8::External
 * creation/access and make SetNativeDataProperty(..., 0, ...) ambiguous.
 * better-sqlite3 has an upstream compatibility fix, but until the dependency
 * release includes it this idempotent build-time patch keeps Linux native
 * rebuilds working.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODULE = path.join(ROOT, "node_modules", "better-sqlite3");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function writeIfChanged(file, next) {
  const current = read(file);
  if (current === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) {
    throw new Error(`Could not patch ${label}; expected source pattern missing`);
  }
  return text.replace(from, to);
}

function main() {
  if (!fs.existsSync(MODULE)) {
    console.log("[better-sqlite3-electron42] skipped: better-sqlite3 not installed");
    return;
  }

  const addon = path.join(MODULE, "src", "better_sqlite3.cpp");
  const helpers = path.join(MODULE, "src", "util", "helpers.cpp");
  const macros = path.join(MODULE, "src", "util", "macros.cpp");

  let changed = 0;

  changed += writeIfChanged(
    addon,
    replaceOnce(
      read(addon),
      "v8::Local<v8::External> data = v8::External::New(isolate, addon);",
      "v8::Local<v8::External> data = EXTERNAL_NEW(isolate, addon);",
      "better_sqlite3.cpp external creation",
    ),
  ) ? 1 : 0;

  changed += writeIfChanged(
    helpers,
    replaceOnce(
      read(helpers),
      "\t\tfunc,\n\t\t0,\n\t\tdata",
      "\t\tfunc,\n\t\tnullptr,\n\t\tdata",
      "helpers.cpp SetNativeDataProperty setter",
    ),
  ) ? 1 : 0;

  changed += writeIfChanged(
    macros,
    replaceOnce(
      read(macros),
      "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())",
      [
        "#if defined(NODE_MODULE_VERSION) && NODE_MODULE_VERSION >= 146",
        "#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value), 0)",
        "#define EXTERNAL_VALUE(value) (value)->Value(0)",
        "#else",
        "#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value))",
        "#define EXTERNAL_VALUE(value) (value)->Value()",
        "#endif",
        "#define OnlyAddon static_cast<Addon*>(EXTERNAL_VALUE(info.Data().As<v8::External>()))",
      ].join("\n"),
      "macros.cpp external access",
    ),
  ) ? 1 : 0;

  const verify = [
    [addon, "EXTERNAL_NEW(isolate, addon)"],
    [helpers, "\t\tnullptr,\n\t\tdata"],
    [macros, "EXTERNAL_VALUE(info.Data().As<v8::External>())"],
  ];
  for (const [file, marker] of verify) {
    if (!read(file).includes(marker)) {
      throw new Error(`Patch verification failed for ${file}`);
    }
  }

  console.log(`[better-sqlite3-electron42] ${changed ? "patched" : "already patched"}`);
}

main();
