/**
 * analyze.js - Statistical analysis for benchmark results
 *
 * Reads CSV files from logs/, computes Mann-Whitney U test,
 * effect size, and saturation point analysis.
 *
 * Usage:
 *   node scripts/analyze.js [--dir logs/]
 */

const fs = require("fs");
const path = require("path");
const config = require("../utils/config");

// -- CSV parsing --------------------------------------------------------

function parseCSV(filePath, stringCols) {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const strSet = new Set(stringCols || []);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",");
    if (vals.length < header.length) continue;
    const row = {};
    header.forEach((h, idx) => {
      const v = (vals[idx] || "").trim();
      row[h] = strSet.has(h) ? v : parseFloat(v) || 0;
    });
    rows.push(row);
  }
  return rows;
}

function parseMemoryMiB(memStr) {
  if (!memStr || typeof memStr !== "string") return 0;
  const s = memStr.trim();
  if (s.endsWith("GiB")) return parseFloat(s) * 1024;
  if (s.endsWith("MiB")) return parseFloat(s);
  if (s.endsWith("KiB")) return parseFloat(s) / 1024;
  return parseFloat(s) || 0;
}

// -- collect data -------------------------------------------------------

function collectData(logDir) {
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".csv"));
  const data = { ibft: {}, qbft: {} };

  for (const file of files) {
    if (file.startsWith("resource_")) continue;

    let protocol = null;
    let profile = null;

    if (file.startsWith("ibft_")) protocol = "ibft";
    else if (file.startsWith("qbft_")) protocol = "qbft";
    else continue;

    if (file.includes("_baseline_")) profile = "baseline";
    else if (file.includes("_chaos_latency_")) profile = "chaos_latency";
    else if (file.includes("_chaos_packetloss_")) profile = "chaos_packetloss";
    else if (file.includes("_chaos_combined_")) profile = "chaos_combined";
    else continue;

    const rows = parseCSV(path.join(logDir, file));
    if (!data[protocol][profile]) data[protocol][profile] = [];
    data[protocol][profile].push(...rows);
  }

  return data;
}

// -- Mann-Whitney U Test ------------------------------------------------

function mannWhitneyU(sample1, sample2) {
  const n1 = sample1.length;
  const n2 = sample2.length;
  if (n1 === 0 || n2 === 0) return { U: 0, z: 0, p: 1, significant: false };

  // Combine and rank
  const combined = [
    ...sample1.map((v) => ({ v, group: 1 })),
    ...sample2.map((v) => ({ v, group: 2 })),
  ].sort((a, b) => a.v - b.v);

  // Assign ranks (handle ties)
  const ranks = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-indexed average
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  // Sum ranks per group
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].group === 1) R1 += ranks[k];
  }

  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation
  const meanU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = sigmaU > 0 ? (U - meanU) / sigmaU : 0;

  // Two-tailed p-value (approx via standard normal CDF)
  const p = 2 * normalCDF(-Math.abs(z));
  const significant = p < 0.05;

  return { U, z, p, significant, U1, U2, n1, n2 };
}

// Standard normal CDF approximation (Abramowitz & Stegun)
function normalCDF(x) {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741;
  const a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// Rank-biserial correlation (effect size)
function rankBiserial(U1, n1, n2) {
  if (n1 * n2 === 0) return 0;
  return 1 - (2 * U1) / (n1 * n2);
}

// -- aggregation helpers ------------------------------------------------

function groupByTps(rows) {
  const groups = {};
  for (const row of rows) {
    const tps = row.tps_target;
    if (!groups[tps]) groups[tps] = [];
    groups[tps].push(row);
  }
  return groups;
}

function mean(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(
    arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1),
  );
}

// -- saturation analysis ------------------------------------------------

function findSaturationPoint(tpsGroups) {
  const sorted = Object.keys(tpsGroups)
    .map(Number)
    .sort((a, b) => a - b);

  let prevThroughput = 0;
  for (const tps of sorted) {
    const throughputs = tpsGroups[tps].map((r) => r.throughput);
    const avgThroughput = mean(throughputs);

    // Saturation: throughput stops increasing meaningfully (< 10% increase)
    if (prevThroughput > 0 && avgThroughput < prevThroughput * 1.1) {
      return { tps, avgThroughput, prevThroughput };
    }
    prevThroughput = avgThroughput;
  }
  return { tps: sorted[sorted.length - 1], avgThroughput: prevThroughput };
}

// -- analysis output ----------------------------------------------------

function analyzeBaseline(data, logDir) {
  console.log("\n" + "".repeat(70));
  console.log("  BASELINE ANALYSIS - IBFT 2.0 vs QBFT");
  console.log("".repeat(70));

  const ibftData = data.ibft.baseline || [];
  const qbftData = data.qbft.baseline || [];

  if (ibftData.length === 0 && qbftData.length === 0) {
    console.log("  No baseline data found.");
    return;
  }

  const ibftByTps = groupByTps(ibftData);
  const qbftByTps = groupByTps(qbftData);
  const allTps = [
    ...new Set([
      ...Object.keys(ibftByTps).map(Number),
      ...Object.keys(qbftByTps).map(Number),
    ]),
  ].sort((a, b) => a - b);

  // Summary table
  const csvRows = [
    "tps_target,metric,ibft_mean,ibft_std,qbft_mean,qbft_std,U,z,p_value,significant,effect_size",
  ];
  const metrics = ["throughput", "latency_mean", "latency_p50", "latency_p95"];

  for (const tps of allTps) {
    console.log(`\n  TPS Target: ${tps}`);
    console.log("  " + "-".repeat(66));
    console.log(
      "  Metric          | IBFT Mean±SD         | QBFT Mean±SD         | p-value  | Sig",
    );
    console.log("  " + "-".repeat(66));

    const ibftRows = ibftByTps[tps] || [];
    const qbftRows = qbftByTps[tps] || [];

    for (const metric of metrics) {
      const ibftVals = ibftRows.map((r) => r[metric]);
      const qbftVals = qbftRows.map((r) => r[metric]);

      const ibftM = mean(ibftVals).toFixed(2);
      const ibftS = stddev(ibftVals).toFixed(2);
      const qbftM = mean(qbftVals).toFixed(2);
      const qbftS = stddev(qbftVals).toFixed(2);

      const test = mannWhitneyU(ibftVals, qbftVals);
      const es = rankBiserial(test.U1 || 0, test.n1, test.n2).toFixed(3);

      const sigMark = test.significant ? " *" : "  ";
      const metricLabel = metric.padEnd(16);
      const ibftStr = `${ibftM}±${ibftS}`.padEnd(20);
      const qbftStr = `${qbftM}±${qbftS}`.padEnd(20);

      console.log(
        `  ${metricLabel} | ${ibftStr} | ${qbftStr} | ${test.p
          .toFixed(4)
          .padEnd(8)} | ${sigMark}`,
      );

      csvRows.push(
        `${tps},${metric},${ibftM},${ibftS},${qbftM},${qbftS},${
          test.U
        },${test.z.toFixed(4)},${test.p.toFixed(6)},${test.significant},${es}`,
      );
    }
  }

  // Saturation point
  console.log("\n  SATURATION ANALYSIS");
  console.log("  " + "-".repeat(40));

  if (Object.keys(ibftByTps).length > 0) {
    const ibftSat = findSaturationPoint(ibftByTps);
    console.log(
      `  IBFT 2.0: saturates at ~${ibftSat.tps} TPS (throughput ≈ ${
        ibftSat.avgThroughput?.toFixed(2) || "N/A"
      })`,
    );
  }
  if (Object.keys(qbftByTps).length > 0) {
    const qbftSat = findSaturationPoint(qbftByTps);
    console.log(
      `  QBFT:     saturates at ~${qbftSat.tps} TPS (throughput ≈ ${
        qbftSat.avgThroughput?.toFixed(2) || "N/A"
      })`,
    );
  }

  // Write CSV
  const csvPath = path.join(logDir, "analysis_baseline.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n") + "\n");
  console.log(`\n   Saved to: ${csvPath}`);
}

function analyzeChaos(data, logDir) {
  console.log("\n" + "".repeat(70));
  console.log("  CHAOS ANALYSIS - IBFT 2.0 vs QBFT");
  console.log("".repeat(70));

  const chaosTypes = ["chaos_latency", "chaos_packetloss", "chaos_combined"];
  const csvRows = [
    "chaos_type,metric,ibft_mean,ibft_std,qbft_mean,qbft_std,U,z,p_value,significant,effect_size",
  ];

  for (const ct of chaosTypes) {
    const ibftData = data.ibft[ct] || [];
    const qbftData = data.qbft[ct] || [];

    if (ibftData.length === 0 && qbftData.length === 0) continue;

    const label = config.profiles[ct]?.label || ct;
    console.log(`\n  ${label}`);
    console.log("  " + "-".repeat(66));
    console.log(
      "  Metric          | IBFT Mean±SD         | QBFT Mean±SD         | p-value  | Sig",
    );
    console.log("  " + "-".repeat(66));

    const metrics = [
      "throughput",
      "latency_mean",
      "latency_p50",
      "latency_p95",
    ];

    for (const metric of metrics) {
      const ibftVals = ibftData.map((r) => r[metric]);
      const qbftVals = qbftData.map((r) => r[metric]);

      const ibftM = mean(ibftVals).toFixed(2);
      const ibftS = stddev(ibftVals).toFixed(2);
      const qbftM = mean(qbftVals).toFixed(2);
      const qbftS = stddev(qbftVals).toFixed(2);

      const test = mannWhitneyU(ibftVals, qbftVals);
      const es = rankBiserial(test.U1 || 0, test.n1, test.n2).toFixed(3);

      const sigMark = test.significant ? " *" : "  ";
      const metricLabel = metric.padEnd(16);
      const ibftStr = `${ibftM}±${ibftS}`.padEnd(20);
      const qbftStr = `${qbftM}±${qbftS}`.padEnd(20);

      console.log(
        `  ${metricLabel} | ${ibftStr} | ${qbftStr} | ${test.p
          .toFixed(4)
          .padEnd(8)} | ${sigMark}`,
      );

      csvRows.push(
        `${ct},${metric},${ibftM},${ibftS},${qbftM},${qbftS},${
          test.U
        },${test.z.toFixed(4)},${test.p.toFixed(6)},${test.significant},${es}`,
      );
    }

    // Check round change logs
    for (const proto of ["ibft", "qbft"]) {
      const chaosTypeShort = ct.replace("chaos_", "");
      const rcFile = path.join(
        logDir,
        `${proto}_${chaosTypeShort}_roundchange.log`,
      );
      if (fs.existsSync(rcFile)) {
        const content = fs.readFileSync(rcFile, "utf8");
        const eventLines = content.split("\n").filter((l) => l.startsWith("["));
        console.log(
          `  ${proto.toUpperCase()} round changes: ${eventLines.length}`,
        );
      }
    }
  }

  const csvPath = path.join(logDir, "analysis_chaos.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n") + "\n");
  console.log(`\n   Saved to: ${csvPath}`);
}

// -- resource analysis --------------------------------------------------

function collectResourceData(logDir) {
  const files = fs.readdirSync(logDir).filter((f) => f.startsWith("resource_") && f.endsWith(".csv"));
  const data = { ibft: {}, qbft: {} };

  for (const file of files) {
    let protocol = null;
    let profile = null;

    if (file.includes("_ibft_")) protocol = "ibft";
    else if (file.includes("_qbft_")) protocol = "qbft";
    else continue;

    if (file.includes("_baseline_")) profile = "baseline";
    else if (file.includes("_chaos_latency_")) profile = "chaos_latency";
    else if (file.includes("_chaos_packetloss_")) profile = "chaos_packetloss";
    else if (file.includes("_chaos_combined_")) profile = "chaos_combined";
    else continue;

    const rows = parseCSV(path.join(logDir, file), ["Timestamp", "Container"]);
    if (!data[protocol][profile]) data[protocol][profile] = [];
    data[protocol][profile] = data[protocol][profile].concat(rows);
  }

  return data;
}

function analyzeResources(logDir) {
  console.log("\n" + "".repeat(70));
  console.log("  RESOURCE UTILIZATION ANALYSIS - IBFT 2.0 vs QBFT");
  console.log("".repeat(70));

  const data = collectResourceData(logDir);
  const profiles = ["baseline", "chaos_latency", "chaos_packetloss", "chaos_combined"];
  const csvRows = [
    "profile,metric,ibft_mean,ibft_std,qbft_mean,qbft_std,U,z,p_value,significant,effect_size",
  ];

  for (const prof of profiles) {
    const ibftData = data.ibft[prof] || [];
    const qbftData = data.qbft[prof] || [];

    if (ibftData.length === 0 && qbftData.length === 0) continue;

    const label = config.profiles[prof]?.label || prof;
    console.log(`\n  Profile: ${label}`);
    console.log("  " + "-".repeat(66));
    console.log(
      "  Metric          | IBFT Mean±SD         | QBFT Mean±SD         | p-value  | Sig",
    );
    console.log("  " + "-".repeat(66));

    const metrics = [
      { name: "CPU(%)", label: "CPU Usage (%)" },
      { name: "MemUsed_MiB", label: "RAM (MiB)" },
    ];

    for (const m of metrics) {
      const ibftVals = ibftData.map((r) => r[m.name]).filter((v) => typeof v === "number");
      const qbftVals = qbftData.map((r) => r[m.name]).filter((v) => typeof v === "number");

      const ibftM = mean(ibftVals).toFixed(2);
      const ibftS = stddev(ibftVals).toFixed(2);
      const qbftM = mean(qbftVals).toFixed(2);
      const qbftS = stddev(qbftVals).toFixed(2);

      const test = mannWhitneyU(ibftVals, qbftVals);
      const es = rankBiserial(test.U1 || 0, test.n1, test.n2).toFixed(3);

      const sigMark = test.significant ? " *" : "  ";
      const metricLabel = m.label.padEnd(16);
      const ibftStr = `${ibftM}±${ibftS}`.padEnd(20);
      const qbftStr = `${qbftM}±${qbftS}`.padEnd(20);

      console.log(
        `  ${metricLabel} | ${ibftStr} | ${qbftStr} | ${test.p
          .toFixed(4)
          .padEnd(8)} | ${sigMark}`,
      );

      csvRows.push(
        `${prof},${m.name},${ibftM},${ibftS},${qbftM},${qbftS},${
          test.U
        },${test.z.toFixed(4)},${test.p.toFixed(6)},${test.significant},${es}`,
      );
    }
  }

  const csvPath = path.join(logDir, "analysis_resource.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n") + "\n");
  console.log(`\n   Saved to: ${csvPath}`);
}

// -- main ---------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let logDir = config.logDir;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") logDir = args[++i];
  }

  console.log(`\n Analyzing data from: ${logDir}`);

  const data = collectData(logDir);

  const totalRows =
    Object.values(data.ibft).reduce((s, a) => s + a.length, 0) +
    Object.values(data.qbft).reduce((s, a) => s + a.length, 0);

  console.log(`   Found ${totalRows} data rows total`);
  console.log(
    `   IBFT: ${
      Object.entries(data.ibft)
        .map(([k, v]) => `${k}(${v.length})`)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `   QBFT: ${
      Object.entries(data.qbft)
        .map(([k, v]) => `${k}(${v.length})`)
        .join(", ") || "none"
    }`,
  );

  analyzeBaseline(data, logDir);
  analyzeChaos(data, logDir);
  analyzeResources(logDir);

  console.log("\n" + "".repeat(70));
  console.log("   Analysis complete!");
  console.log("".repeat(70) + "\n");
}

main();
