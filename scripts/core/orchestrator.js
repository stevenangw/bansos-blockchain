/**
 * scripts/core/orchestrator.js - Main CLI Test Runner
 *
 * Mengkoordinasikan benchmark, monitor, chaos, dan round-change logger.
 * GC hanya dipanggil selama cooldown period (TIDAK PERNAH saat measurement).
 *
 * Hasil ditulis ke CSV via Non-Blocking WriteStream (fs.createWriteStream).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../utils/config");
const { runBenchmark } = require("./benchmark");
const monitor = require("../utils/monitor");
const chaos = require("../utils/chaos");
const roundchange = require("../utils/roundchange");

// -- Helpers ------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function dim(msg)  { return `\x1b[90m${msg}\x1b[0m`; }
function cyan(msg) { return `\x1b[36m${msg}\x1b[0m`; }
function green(msg){ return `\x1b[32m${msg}\x1b[0m`; }
function yellow(msg){ return `\x1b[33m${msg}\x1b[0m`; }

/**
 * Memicu GC hanya jika tersedia (--expose-gc) dan HANYA saat cooldown.
 * Jangan panggil ini selama warmup atau measurement phase.
 */
function tryGC() {
  if (typeof global.gc === "function") {
    global.gc();
    log("  GC triggered (cooldown phase)");
  }
}

// CSV schema - termasuk P99 untuk distribusi ekor latensi yang lebih akurat
const CSV_HEADER =
  "tps_target,tx_sent,tx_ok,tx_fail,throughput,latency_mean,latency_p50,latency_p95,latency_p99\n";

function rowToCsv(row) {
  return [
    row.tps_target,
    row.tx_sent,
    row.tx_ok,
    row.tx_fail,
    row.throughput,
    row.latency_mean,
    row.latency_p50,
    row.latency_p95,
    row.latency_p99 ?? 0, // fallback jika benchmark lama tidak punya P99
  ].join(",");
}

// -- Argument Parser ----------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    protocol: null,
    profileName: null,
    run: null,
    tps: null,
    startRun: 1,
    startTps: 0,
    dryRun: false,
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--run":
        opts.run = parseInt(args[++i]);
        break;
      case "--tps":
        opts.tps = parseInt(args[++i]);
        break;
      case "--start-run":
        opts.startRun = parseInt(args[++i]);
        break;
      case "--start-tps":
        opts.startTps = parseInt(args[++i]);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        positional.push(args[i]);
    }
  }

  opts.protocol = positional[0];
  opts.profileName = positional[1] || "baseline";
  return opts;
}

// -- Main Orchestrator --------------------------------------------------

async function main() {
  const opts = parseArgs();

  if (!opts.protocol || !config.networks[opts.protocol]) {
    console.error(
      "Usage: node scripts/core/orchestrator.js <ibft|qbft> <profile> [options]",
    );
    process.exit(1);
  }

  const profile = config.profiles[opts.profileName];
  if (!profile) {
    console.error(`Unknown profile: ${opts.profileName}`);
    process.exit(1);
  }

  const protocol = opts.protocol;
  const netName = config.networks[protocol].name;
  const isChaos = profile.chaosType !== "none";

  log(`\n${cyan("")}`);
  log(cyan(`  ${netName.padEnd(24)}  Profile: ${profile.label.padEnd(20)}`));
  log(cyan(""));

  let tpsTargets = [...profile.tpsTargets];
  if (opts.tps) tpsTargets = tpsTargets.filter((t) => t === opts.tps);
  if (opts.startTps > 0)
    tpsTargets = tpsTargets.filter((t) => t >= opts.startTps);

  let reps = [];
  for (let i = 1; i <= profile.repetitions; i++) reps.push(i);
  if (opts.run) reps = [opts.run];
  else if (opts.startRun > 1) reps = reps.filter((r) => r >= opts.startRun);

  const totalRuns = tpsTargets.length * reps.length;
  log(
    dim(`  Plan: ${totalRuns} run(s) | TPS: [${tpsTargets.join(", ")}] | Reps: [${reps.join(", ")}]`),
  );

  if (opts.dryRun) {
    log(" Dry run - exiting without execution.");
    process.exit(0);
  }

  if (!fs.existsSync(config.logDir))
    fs.mkdirSync(config.logDir, { recursive: true });

  // -- Resource Monitor (Single Process, Continuous Stream) -----------
  const monitorPath = monitor.start(protocol, opts.profileName);
  log(` Resource monitor  ${monitorPath}`);

  // -- Chaos Setup ----------------------------------------------------
  if (isChaos) {
    log(`\n  Applying chaos: ${profile.chaosType}...`);
    chaos.apply(protocol, profile.chaosType);
    log(" Verifying chaos rules...");
    chaos.verify(protocol);
    const stabilizeMs = config.chaos.stabilizeMs || 5000;
    log(` Waiting ${stabilizeMs/1000}s for chaos to stabilize...`);
    await sleep(stabilizeMs);
    const rcPath = roundchange.start(protocol, profile.chaosType);
    log(` Round change logger  ${rcPath}`);
  }

  const date = dateTag();
  let runCounter = 0;

  try {
    for (const rep of reps) {
      const padRep = String(rep).padStart(2, "0");
      const csvName = `${protocol}_${opts.profileName}_run${padRep}_${date}.csv`;
      const csvPath = path.join(config.logDir, csvName);

      // Non-blocking CSV write stream
      const resultStream = fs.createWriteStream(csvPath, { flags: "a" });
      resultStream.write(CSV_HEADER);

        log(`\n${cyan(`[RUN ${rep}/${profile.repetitions}]`)}  ${dim(csvName)}`);

      for (const tps of tpsTargets) {
        runCounter++;
        log(dim(`\n [${runCounter}/${totalRuns}] TPS=${tps} Rep=${rep}/${profile.repetitions}`));

        try {
          const result = await runBenchmark(protocol, tps);
          const csvLine = rowToCsv(result);
          resultStream.write(csvLine + "\n");
          log(dim(`   ${csvName}`));
        } catch (err) {
          log(`   Benchmark error: ${err.message}`);
          resultStream.write(`${tps},0,0,0,0,0,0,0,0\n`);
        }

        // Cooldown between TPS levels - GC setelah benchmark selesai
        if (tps !== tpsTargets[tpsTargets.length - 1]) {
          const cd = config.benchmark.cooldownBetweenTps / 1000;
          log(dim(`   Cooldown ${cd}s...`));
          await sleep(config.benchmark.cooldownBetweenTps);
          tryGC();
        }
      }

      // Flush dan tutup stream CSV run ini
      await new Promise((resolve) => resultStream.end(resolve));
      log(green(`\n Run ${rep}/${profile.repetitions} selesai  ${csvPath}`));

      // Cooldown between repetitions
      if (rep !== reps[reps.length - 1]) {
        const cdRun = config.benchmark.cooldownBetweenRuns / 1000;
        log(dim(`\n Cooldown ${cdRun}s antar repetisi...`));
        await sleep(config.benchmark.cooldownBetweenRuns);
        tryGC();

        log(dim("\n   Mempool recovery 30s..."));
        await sleep(30000);
      }
    }
  } finally {
    log(dim("\n Cleanup..."));
    if (isChaos) {
      const rcCount = roundchange.stop();
      log(` Round change events: ${rcCount}`);
      log("  Clearing chaos rules...");
      chaos.clear(protocol);
    }
    monitor.stop();
    log(green("\n Semua benchmark selesai!"));
  }
}

// -- Global Error Handlers ----------------------------------------------

process.on("unhandledRejection", (reason) => {
  // Error-error ini adalah kondisi normal selama/setelah high-TPS benchmark:
  //   ECONNRESET        - koneksi TCP putus saat node kelebihan beban
  //   UNSUPPORTED_OPERATION - ethers v6: provider sudah di-destroy, .wait() terlambat
  //   EADDRINUSE        - socket lama belum sepenuhnya terbebas saat reconnect
  if (!reason) return;
  if (reason.code === "ECONNRESET") return;
  if (reason.code === "EADDRINUSE") return;
  if (reason.code === "UNSUPPORTED_OPERATION") return;
  // Juga tangkap via pesan string untuk jaga-jaga ethers wrapping error
  const msg = reason.message ?? String(reason);
  if (msg.includes("provider destroyed") || msg.includes("cancelled request")) return;
  // Log rejection lain tapi jangan exit (benchmark mungkin masih berjalan)
  console.error(`\n  Unhandled rejection: ${msg}`);
});

process.on("uncaughtException", (err) => {
  if (err && err.code === "ECONNRESET") return;
  console.error(`\n Fatal error: ${err.message}`);
  try {
    monitor.stop();
  } catch (_) {}
  try {
    roundchange.stop();
  } catch (_) {}
  process.exit(1);
});

main().catch((err) => {
  console.error(`\n Fatal error: ${err.message}`);
  try {
    monitor.stop();
  } catch (_) {}
  try {
    roundchange.stop();
  } catch (_) {}
  process.exit(1);
});
