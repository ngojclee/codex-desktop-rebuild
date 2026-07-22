#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

async function main() {
  const [archivePathArg, destinationArg] = process.argv.slice(2);
  if (!archivePathArg || !destinationArg) {
    console.error("[x] Usage: extract-asar-tolerant.js <archive> <destination>");
    process.exit(2);
  }

  const archivePath = path.resolve(archivePathArg);
  const destination = path.resolve(destinationArg);
  const asar = await import("@electron/asar");

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  const skipped = [];
  const entries = asar.listPackage(archivePath, { isPack: false });

  for (const archiveEntry of entries) {
    const filename = archiveEntry.replace(/^[/\\]+/, "");
    if (!filename) continue;

    const outputPath = path.join(destination, filename);
    const relativeOutput = path.relative(destination, outputPath);
    if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
      throw new Error(`${archiveEntry} writes outside ${destination}`);
    }

    const metadata = asar.statFile(archivePath, filename, false);
    if ("files" in metadata) {
      fs.mkdirSync(outputPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    try {
      // On Windows, match extractAll behavior by resolving links to files.
      const content = asar.extractFile(archivePath, filename, true);
      fs.writeFileSync(outputPath, content);
      if (metadata.executable) {
        fs.chmodSync(outputPath, 0o755);
      }
    } catch (error) {
      if (metadata.unpacked && error?.code === "ENOENT") {
        skipped.push(filename);
        continue;
      }
      throw error;
    }
  }

  for (const filename of skipped) {
    console.log(`   [skip] upstream omitted unpacked ASAR entry: ${filename}`);
  }
  console.log(
    `   [ok] tolerant ASAR extraction completed (${skipped.length} missing unpacked entries skipped)`
  );
}

main().catch((error) => {
  console.error(`[x] ${error.stack || error.message || error}`);
  process.exit(1);
});
