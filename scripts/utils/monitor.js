/**
 * scripts/utils/monitor.js - Zero-Overhead Resource Monitor
 *
 * ARSITEKTUR NON-BLOCKING:
 *
 * 1. SINGLE PROCESS SPAWN: `docker stats` di-spawn SEKALI SAJA (tanpa
 *    --no-stream) dan dibiarkan mengalir secara konstan. Ini mengeliminasi
 *    overhead fork/exec yang terjadi jika menggunakan setInterval + execAsync.
 *
 * 2. STREAM I/O: Data ditulis ke file via fs.createWriteStream yang
 *    menggunakan libuv non-blocking I/O. fs.appendFileSync/writeFileSync
 *    TIDAK digunakan karena memblokir event loop.
 *
 * 3. WINDOWS COMPATIBILITY: Output docker stats di Windows mengandung
 *    ANSI escape codes (\x1b[...m) dan carriage return (\r). Data handler
 *    menyaring karakter ini sebelum parsing CSV agar data CSV bersih.
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");

// -- State (module-level singleton) -------------------------------------
let dockerProcess = null;
let writeStream = null;
let csvPath = null;
let remainder = "";

const CSV_HEADER = "Timestamp,Container,CPU(%),MemUsed_MiB\n";

// Regex untuk menyaring ANSI escape codes yang di-inject docker pada TTY
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// -- Public API ---------------------------------------------------------

/**
 * Memulai monitoring resource untuk protokol yang dipilih.
 * Jika monitor sebelumnya masih berjalan, di-stop terlebih dahulu.
 *
 * @param {string} protocol  - "ibft" atau "qbft"
 * @param {string} testType  - nama profil ("baseline", "chaos_latency", dst.)
 * @returns {string}         - path file CSV output
 */
function start(protocol, testType) {
  if (dockerProcess) stop();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  csvPath = path.join(
    config.logDir,
    `resource_${protocol}_${testType}_${ts}.csv`,
  );
  remainder = "";

  // Non-blocking write stream - libuv akan flush ke disk secara async
  writeStream = fs.createWriteStream(csvPath, { flags: "a" });
  writeStream.write(CSV_HEADER);

  const containerPrefix = config.networks[protocol].containerPrefix;

  console.log(`[Monitor]  Started stream - protocol=${protocol}`);
  console.log(`[Monitor]  Writing  ${csvPath}`);

  // Spawn SEKALI, tanpa --no-stream, biarkan stdout mengalir terus
  dockerProcess = spawn(
    "docker",
    [
      "stats",
      "--format",
      "{{.Name}},{{.CPUPerc}},{{.MemUsage}}",
      // Tidak ada --no-stream: proses ini hidup selama benchmark berlangsung
    ],
    {
      windowsHide: true,
      // Jangan pipe stderr ke parent - cukup ignore untuk menghindari noise
    },
  );

  dockerProcess.stdout.on("data", (chunk) => {
    // Sanitasi: strip ANSI codes dan carriage returns (\r) yang di-emit
    // oleh docker stats pada terminal Windows
    const raw = chunk.toString().replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
    const data = remainder + raw;
    const lines = data.split("\n");

    // Baris terakhir mungkin terpotong di tengah chunk - simpan untuk iterasi berikutnya
    remainder = lines.pop();

    const timestamp = new Date().toISOString();
    const outputRows = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: "besu-ibft-node1,5.23%,256MiB / 2.44GiB"
      const parts = trimmed.split(",");
      if (parts.length < 3) continue;

      const name = parts[0].trim();
      if (!name.startsWith(containerPrefix)) continue;

      // CPU: strip "%"  numeric string
      const cpu = parts[1].trim().replace("%", "");

      // Memory: ambil sisi kiri dari " / " (used), strip unit suffix
      const rawMem = parts.slice(2).join(",").trim(); // handle komma dalam angka
      const memUsed = rawMem.split("/")[0].trim();

      // Konversi ke MiB untuk konsistensi numerik di CSV
      const memMiB = parseMiB(memUsed);

      outputRows.push(`${timestamp},${name},${cpu},${memMiB}\n`);
    }

    if (outputRows.length > 0 && writeStream) {
      writeStream.write(outputRows.join(""));
    }
  });

  // Abaikan stderr sepenuhnya - error docker stats tidak boleh crash benchmark
  dockerProcess.stderr?.on("data", () => {});

  dockerProcess.on("error", () => {
    // Proses docker tidak ditemukan atau gagal start - log tapi jangan crash
    console.warn(
      "[Monitor]   docker stats process error (abaikan jika docker tidak berjalan)",
    );
  });

  dockerProcess.on("close", () => {
    // Proses berhenti (mungkin karena docker dimatikan)
    dockerProcess = null;
  });

  return csvPath;
}

/**
 * Menghentikan monitor dan menutup write stream.
 * @returns {string|null} path file CSV yang telah selesai ditulis
 */
function stop() {
  if (dockerProcess) {
    dockerProcess.kill("SIGTERM");
    dockerProcess = null;
  }
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
  const p = csvPath;
  if (p) console.log(`[Monitor]   Stopped - data: ${p}`);
  csvPath = null;
  remainder = "";
  return p;
}

/**
 * Mengembalikan path CSV yang sedang aktif (untuk logging dari orchestrator).
 * @returns {string|null}
 */
function getPath() {
  return csvPath;
}

// -- Internal Helpers ---------------------------------------------------

/**
 * Mengkonversi string memori Docker (e.g. "256MiB", "1.5GiB", "512kB")
 * ke nilai numerik MiB (2 desimal) untuk konsistensi kolom CSV.
 *
 * @param {string} raw - string memori dari docker stats output
 * @returns {string}   - nilai dalam MiB sebagai string desimal
 */
function parseMiB(raw) {
  const s = raw.toUpperCase().trim();
  const val = parseFloat(s);
  if (isNaN(val)) return raw; // fallback: kembalikan string asli

  if (s.endsWith("GIB")) return (val * 1024).toFixed(2);
  if (s.endsWith("MIB")) return val.toFixed(2);
  if (s.endsWith("KIB")) return (val / 1024).toFixed(2);
  if (s.endsWith("GB")) return (val * 953.674).toFixed(2); // 1 GB = 953.674 MiB
  if (s.endsWith("MB")) return (val * 0.953674).toFixed(2);
  if (s.endsWith("KB")) return (val * 0.000977).toFixed(2);
  return raw; // unit tidak dikenal, kembalikan apa adanya
}

module.exports = { start, stop, getPath };
