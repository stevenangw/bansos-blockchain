/**
 * merge_logs.js - Consolidate individual run CSVs into merged files
 *
 * Merges:
 *   ibft_baseline_run01..10   ibft_baseline_all.csv  (with run_id column)
 *   qbft_baseline_run01..10   qbft_baseline_all.csv
 *   ibft_chaos_combined_run01..05  ibft_chaos_combined_all.csv
 *   qbft_chaos_combined_run01..05  qbft_chaos_combined_all.csv
 *   resource_ibft_baseline_*.csv   resource_ibft_baseline_all.csv
 *   resource_qbft_baseline_*.csv   resource_qbft_baseline_all.csv
 *   resource_*_chaos_combined_*    resource_*_chaos_combined_all.csv
 *
 * Originals are moved to logs/_originals/ for backup.
 *
 * Usage: node scripts/automation/merge_logs.js
 */

const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "..", "..", "logs");
const backupDir = path.join(logDir, "_originals");

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".csv"));

// -- 1. Merge benchmark CSVs (small files with run## pattern) -----------

function mergeBenchmarkCSVs() {
  // Group files by protocol + profile
  const groups = {};
  const runPattern = /^(ibft|qbft)_(baseline|chaos_latency|chaos_packetloss|chaos_combined)_run(\d+)_.+\.csv$/;

  for (const file of files) {
    const m = file.match(runPattern);
    if (!m) continue;
    const key = `${m[1]}_${m[2]}`; // e.g. "ibft_baseline"
    const runId = parseInt(m[3], 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push({ file, runId });
  }

  for (const [key, entries] of Object.entries(groups)) {
    entries.sort((a, b) => a.runId - b.runId);

    const outFile = path.join(logDir, `${key}_all.csv`);
    let header = null;
    const allRows = [];

    for (const { file, runId } of entries) {
      const content = fs.readFileSync(path.join(logDir, file), "utf8").trim();
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length < 2) continue;

      if (!header) {
        header = "run_id," + lines[0];
      }

      for (let i = 1; i < lines.length; i++) {
        allRows.push(`${runId},${lines[i]}`);
      }
    }

    if (header && allRows.length > 0) {
      fs.writeFileSync(outFile, header + "\n" + allRows.join("\n") + "\n");
      console.log(`   ${key}: ${entries.length} files  ${path.basename(outFile)} (${allRows.length} rows)`);

      // Move originals to backup
      for (const { file } of entries) {
        fs.renameSync(path.join(logDir, file), path.join(backupDir, file));
      }
    }
  }
}

// -- 2. Merge resource CSVs (large files) -------------------------------

function mergeResourceCSVs() {
  const groups = {};
  const resPattern = /^resource_(ibft|qbft)_(baseline|chaos_latency|chaos_packetloss|chaos_combined)_.+\.csv$/;

  for (const file of files) {
    const m = file.match(resPattern);
    if (!m) continue;
    const key = `resource_${m[1]}_${m[2]}`; // e.g. "resource_ibft_baseline"
    if (!groups[key]) groups[key] = [];
    groups[key].push(file);
  }

  for (const [key, entries] of Object.entries(groups)) {
    entries.sort();

    const outFile = path.join(logDir, `${key}_all.csv`);
    let header = null;
    let totalRows = 0;

    // Use streaming approach for large files
    const writeStream = fs.createWriteStream(outFile);

    for (const file of entries) {
      const content = fs.readFileSync(path.join(logDir, file), "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (i === 0) {
          // Header line
          if (!header) {
            header = line;
            writeStream.write(header + "\n");
          }
          continue; // skip header from subsequent files
        }

        writeStream.write(line + "\n");
        totalRows++;
      }
    }

    writeStream.end();
    console.log(`   ${key}: ${entries.length} files  ${path.basename(outFile)} (${totalRows.toLocaleString()} rows)`);

    // Move originals to backup
    for (const file of entries) {
      fs.renameSync(path.join(logDir, file), path.join(backupDir, file));
    }
  }
}

// -- main ---------------------------------------------------------------

console.log("\n Merging log files...\n");
console.log("  Benchmark CSVs:");
mergeBenchmarkCSVs();
console.log("\n  Resource CSVs:");
mergeResourceCSVs();

// Count final files
const remaining = fs.readdirSync(logDir).filter((f) => f.endsWith(".csv") || f.endsWith(".json") || f.endsWith(".log"));
const backed = fs.readdirSync(backupDir).length;
console.log(`\n Result: ${remaining.length} files in logs/, ${backed} originals backed up to logs/_originals/`);
console.log(" Done!\n");
