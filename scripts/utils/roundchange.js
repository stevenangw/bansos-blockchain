/**
 * scripts/utils/roundchange.js - Consensus Round-Change Event Logger
 *
 * Memonitor log Docker container Besu secara real-time dan menangkap
 * event round-change yang terjadi selama chaos injection.
 *
 * Round-change pada BFT consensus mengindikasikan bahwa proposer
 * gagal menghasilkan block dalam waktu yang ditentukan, sehingga
 * validator lain mengambil alih. Frekuensi round-change adalah
 * indikator utama robustness consensus protocol.
 *
 * Besu log keywords:
 *   - "Received ROUND_CHANGE" (IBFT 2.0 & QBFT)
 *   - "Round change" / "round_change"
 *   - "NewRound" - round baru dimulai setelah timeout
 *
 * Output: File log di logs/<protocol>_<chaosType>_roundchange.log
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");

// -- State (singleton) --------------------------------------------------

let tailProcesses = [];
let writeStream = null;
let logPath = null;
let eventCount = 0;
let remainder = "";

// ANSI escape code stripper (docker logs di Windows bisa mengandung ANSI codes)
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// Keywords yang mengindikasikan round-change event di Besu logs
const ROUND_CHANGE_PATTERNS = [
  /round.?change/i,
  /ROUND_CHANGE/,
  /NewRound/i,
  /round\s+timer\s+expired/i,
  /proposer\s+change/i,
];

// -- Public API ---------------------------------------------------------

/**
 * Mulai memonitor round-change events dari semua node.
 *
 * @param {string} protocol  - "ibft" atau "qbft"
 * @param {string} chaosType - nama chaos type (untuk penamaan file)
 * @returns {string} - path file log output
 */
function start(protocol, chaosType) {
  // Stop jika sebelumnya masih jalan
  if (tailProcesses.length > 0) stop();

  eventCount = 0;
  remainder = "";

  // Setup log file
  const logsDir = config.logDir;
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  logPath = path.join(logsDir, `${protocol}_${chaosType}_roundchange.log`);
  writeStream = fs.createWriteStream(logPath, { flags: "w" });

  const header = `# Round-Change Event Log\n# Protocol: ${protocol}\n# Chaos: ${chaosType}\n# Started: ${new Date().toISOString()}\n#\n`;
  writeStream.write(header);

  // Tail logs dari SEMUA container (bukan hanya yang di-inject chaos)
  // karena round-change bisa terjadi di node mana saja
  const prefix = config.networks[protocol].containerPrefix;
  const nodeCount = config.nodeCount || 3;

  for (let i = 1; i <= nodeCount; i++) {
    const containerName = `${prefix}-node${i}`;
    startTailForContainer(containerName);
  }

  console.log(`[RoundChange]  Monitoring ${nodeCount} containers for ${protocol}`);
  console.log(`[RoundChange]  Writing  ${logPath}`);

  return logPath;
}

/**
 * Menghentikan semua tail processes.
 * @returns {number} - jumlah round-change events yang terdeteksi
 */
function stop() {
  for (const proc of tailProcesses) {
    try {
      proc.kill("SIGTERM");
    } catch (_) {}
  }
  tailProcesses = [];

  if (writeStream) {
    const footer = `\n# Stopped: ${new Date().toISOString()}\n# Total round-change events: ${eventCount}\n`;
    writeStream.write(footer);
    writeStream.end();
    writeStream = null;
  }

  const count = eventCount;
  if (logPath) {
    console.log(`[RoundChange]  Stopped - ${count} events captured  ${logPath}`);
  }

  logPath = null;
  eventCount = 0;
  remainder = "";
  return count;
}

/**
 * @returns {number} - jumlah event saat ini (tanpa menghentikan)
 */
function getCount() {
  return eventCount;
}

// -- Internal -----------------------------------------------------------

/**
 * Memulai `docker logs --follow` untuk satu container.
 * @param {string} containerName
 */
function startTailForContainer(containerName) {
  const since = new Date(Date.now() - 5000).toISOString(); // 5 detik ke belakang

  const proc = spawn("docker", [
    "logs",
    "--follow",
    "--since", since,
    containerName,
  ], {
    windowsHide: true,
  });

  // Besu menulis ke stderr (logback default  stderr)
  const handleData = (chunk) => {
    const raw = chunk.toString().replace(ANSI_RE, "").replace(/\r/g, "");
    const data = remainder + raw;
    const lines = data.split("\n");
    remainder = lines.pop(); // simpan baris terakhir yang mungkin terpotong

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check apakah baris ini mengandung round-change event
      const isRoundChange = ROUND_CHANGE_PATTERNS.some((pattern) =>
        pattern.test(trimmed)
      );

      if (isRoundChange) {
        eventCount++;
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${containerName}] ${trimmed}\n`;

        if (writeStream && !writeStream.destroyed) {
          writeStream.write(logLine);
        }
      }
    }
  };

  proc.stdout.on("data", handleData);
  proc.stderr.on("data", handleData); // Besu logs ke stderr

  proc.on("error", () => {
    // Ignore - container mungkin sudah mati
  });

  proc.on("close", () => {
    // Hapus dari array
    const idx = tailProcesses.indexOf(proc);
    if (idx >= 0) tailProcesses.splice(idx, 1);
  });

  tailProcesses.push(proc);
}

module.exports = { start, stop, getCount };
