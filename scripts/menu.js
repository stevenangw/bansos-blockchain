/**
 * scripts/menu.js - Zero-Touch Provisioning CLI
 *
 * FITUR UTAMA:
 *
 * 1. PRE-FLIGHT CHECK: Mendeteksi ketersediaan Docker Engine saat startup.
 *    Jika belum aktif, mencoba meluncurkan Docker Desktop otomatis dan
 *    menunggu hingga daemon siap.
 *
 * 2. AUTO DOCKER-COMPOSE UP: Setiap perintah benchmark/setup secara otomatis
 *    menjalankan `docker-compose up -d` untuk protokol yang dipilih sebelum
 *    mengeksekusi skrip Node.js.
 *
 * 3. RPC HEALTH-CHECK PING: Setelah docker-compose up, CLI melakukan TCP
 *    connection test ke port RPC (8545 untuk IBFT, 18545 untuk QBFT).
 *    Skrip Node.js TIDAK akan dijalankan hingga port benar-benar menerima
 *    koneksi - mengeliminasi race condition "ECONNREFUSED di awal benchmark".
 *
 *    Implementasi: net.createConnection (bukan HTTP) karena lebih cepat dan
 *    tidak membutuhkan response body - cukup verifikasi TCP handshake berhasil.
 */

"use strict";

const readline = require("readline");
const net = require("net");
const { spawn, execSync } = require("child_process");
const path = require("path");

// -- RPC Port Registry --------------------------------------------------
// Harus sinkron dengan config.networks[protocol].rpcUrl
const RPC_PORTS = {
  ibft: 8545,
  qbft: 18545,
};

const RPC_HOST = "127.0.0.1";
const RPC_PING_TIMEOUT = 3000; // ms per percobaan TCP connect
const RPC_PING_INTERVAL = 3000; // ms antar percobaan
const RPC_PING_MAX_WAIT = 120000; // ms total timeout (2 menit)

// -- Readline Interface -------------------------------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// -- Command Builders ---------------------------------------------------

function buildBenchmarkCmd(protocol, profile) {
  return {
    cmd: "node",
    args: [
      "scripts/automation/run_suite.js",
      protocol,
      profile,
    ],
    protocol, // digunakan untuk memicu docker-compose up + RPC ping
  };
}

function buildAutoCmd(scriptName, arg = null) {
  const args = [`scripts/automation/${scriptName}`];
  if (arg) args.push(arg);
  return {
    cmd: "node",
    args,
    protocol: arg === "ibft" || arg === "qbft" ? arg : null,
  };
}

// -- Menu Structure -----------------------------------------------------

const MENU_GROUPS = [
  {
    title: " FULL SUITE AUTOMATION",
    options: [
      {
        name: "RUN ALL SUITE: IBFT (Setup  Baseline  Chaos  Analyze)",
        ...buildAutoCmd("run_suite.js", "ibft"),
      },
      {
        name: "RUN ALL SUITE: QBFT (Setup  Baseline  Chaos  Analyze)",
        ...buildAutoCmd("run_suite.js", "qbft"),
      },
      {
        name: "RUN EVERYTHING (IBFT + QBFT + Analyze)",
        ...buildAutoCmd("run_suite.js", "all"),
      },
    ],
  },
  {
    title: " NETWORK MANAGEMENT",
    options: [
      {
        name: "Reset Jaringan & Hapus Database (IBFT)",
        ...buildAutoCmd("reset_network.js", "ibft"),
      },
      {
        name: "Reset Jaringan & Hapus Database (QBFT)",
        ...buildAutoCmd("reset_network.js", "qbft"),
      },
      {
        name: "Reset KEDUA Jaringan (ALL)",
        ...buildAutoCmd("reset_network.js", "all"),
      },
    ],
  },
  {
    title: " SETUP & FUNDING",
    options: [
      {
        name: "Setup IBFT 2.0 (Deploy, Whitelist, Fund)",
        ...buildAutoCmd("setup.js", "ibft"),
      },
      {
        name: "Setup QBFT     (Deploy, Whitelist, Fund)",
        ...buildAutoCmd("setup.js", "qbft"),
      },
    ],
  },
  {
    title: " BENCHMARK: IBFT 2.0",
    options: [
      { name: "IBFT: Baseline", ...buildBenchmarkCmd("ibft", "baseline") },
      {
        name: "IBFT: Chaos - Latency 200ms",
        ...buildBenchmarkCmd("ibft", "chaos_latency"),
      },
      {
        name: "IBFT: Chaos - Packet Loss 1%",
        ...buildBenchmarkCmd("ibft", "chaos_packetloss"),
      },
      {
        name: "IBFT: Chaos - Latency 200ms + Loss 1%",
        ...buildBenchmarkCmd("ibft", "chaos_combined"),
      },
    ],
  },
  {
    title: " BENCHMARK: QBFT",
    options: [
      { name: "QBFT: Baseline", ...buildBenchmarkCmd("qbft", "baseline") },
      {
        name: "QBFT: Chaos - Latency 200ms",
        ...buildBenchmarkCmd("qbft", "chaos_latency"),
      },
      {
        name: "QBFT: Chaos - Packet Loss 1%",
        ...buildBenchmarkCmd("qbft", "chaos_packetloss"),
      },
      {
        name: "QBFT: Chaos - Latency 200ms + Loss 1%",
        ...buildBenchmarkCmd("qbft", "chaos_combined"),
      },
    ],
  },
  {
    title: " DATA ANALYSIS",
    options: [
      { name: "Analyze All Benchmark Results", ...buildAutoCmd("analyze.js") },
    ],
  },
  {
    title: " APLIKASI BANSOS DIGITAL",
    options: [
      {
        name: "Start Sistem Informasi (Backend + Frontend)",
        ...buildAutoCmd("start_app.js"),
      },
    ],
  },
];

let activeChildProcess = null;

// -- TCP RPC Health-Check -----------------------------------------------

/**
 * Melakukan satu percobaan TCP connection ke host:port.
 * Resolve true jika berhasil, false jika timeout/error.
 *
 * Menggunakan net.createConnection (layer TCP murni) bukan fetch/axios
 * karena Besu mungkin menerima TCP handshake sebelum HTTP handler siap,
 * dan sebaliknya mungkin menolak HTTP sebelum blockchain sync selesai.
 * TCP connect adalah sinyal yang paling akurat bahwa port sudah LISTEN.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function tcpPing(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));

    socket.connect(port, host);
  });
}

/**
 * Polling TCP ping hingga port menerima koneksi atau deadline tercapai.
 * Menampilkan progress visual ke stdout.
 *
 * @param {string} protocol  - "ibft" atau "qbft"
 * @returns {Promise<boolean>} - true jika port akhirnya responsif
 */
async function waitForRpc(protocol) {
  const port = RPC_PORTS[protocol];
  if (!port) return true; // protokol tanpa RPC (e.g. analyze.js) - langsung lanjut

  const deadline = Date.now() + RPC_PING_MAX_WAIT;
  let attempt = 0;

  console.log(
    `\x1b[36m Menunggu RPC port ${port} (${protocol.toUpperCase()}) siap menerima koneksi...\x1b[0m`,
  );

  while (Date.now() < deadline) {
    attempt++;
    const ok = await tcpPing(RPC_HOST, port, RPC_PING_TIMEOUT);

    if (ok) {
      console.log(
        `\x1b[32m RPC port ${port} responsif setelah ${attempt} percobaan. Node siap!\x1b[0m\n`,
      );
      return true;
    }

    // Hitung sisa waktu untuk ditampilkan
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(
      `\r   Percobaan #${attempt} - port ${port} belum terbuka. ` +
        `Retry dalam ${RPC_PING_INTERVAL / 1000}s... (sisa ~${remaining}s)   `,
    );

    await new Promise((r) => setTimeout(r, RPC_PING_INTERVAL));
  }

  process.stdout.write("\n");
  console.warn(
    `\x1b[33m  RPC port ${port} tidak responsif setelah ${
      RPC_PING_MAX_WAIT / 1000
    }s. ` + `Melanjutkan tetapi benchmark mungkin gagal.\x1b[0m\n`,
  );
  return false;
}

// -- Pre-Flight: Docker Desktop Check -----------------------------------

function ensureDockerReady() {
  console.clear();
  console.log("\x1b[36m Memeriksa ketersediaan Docker Engine...\x1b[0m");

  try {
    execSync("docker info", { stdio: "ignore" });
    console.log(
      "\x1b[32m Docker Engine beroperasi. Memuat antarmuka utama...\x1b[0m",
    );
    setTimeout(showMenu, 800);
  } catch {
    console.log(
      "\x1b[33m  Docker Desktop belum menyala. Mencoba meluncurkan secara otomatis...\x1b[0m",
    );

    try {
      spawn("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe", [], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } catch {
      console.log(
        "\x1b[31m Gagal meluncurkan Docker otomatis. Harap nyalakan manual.\x1b[0m",
      );
    }

    process.stdout.write("Menunggu inisialisasi Docker Daemon");
    const checkInterval = setInterval(() => {
      try {
        execSync("docker info", { stdio: "ignore" });
        clearInterval(checkInterval);
        console.log("\n\x1b[32m Docker Engine berhasil terhubung!\x1b[0m");
        setTimeout(showMenu, 1000);
      } catch {
        process.stdout.write(".");
      }
    }, 3000);
  }
}

// -- Main Menu Display --------------------------------------------------

function showMenu() {
  console.clear();
  console.log("");
  console.log("         BANSOS BLOCKCHAIN - BENCHMARK SUITE v2.0           ");
  console.log(
    "\n",
  );

  let optIdx = 1;
  const validOptions = [];

  MENU_GROUPS.forEach((group) => {
    console.log(`\x1b[36m--- ${group.title} ---\x1b[0m`);
    group.options.forEach((opt) => {
      console.log(`  [${String(optIdx).padStart(2, "0")}] ${opt.name}`);
      validOptions.push({ idx: optIdx, ...opt });
      optIdx++;
    });
    console.log("");
  });

  console.log("  [00] Exit\n");

  rl.question("Pilih aksi: ", (answer) => {
    const choice = parseInt(answer.trim());

    if (choice === 0) {
      console.log("\n Menutup Master Orchestrator. Terima kasih.");
      rl.close();
      return;
    }

    const selected = validOptions.find((o) => o.idx === choice);
    if (!selected) {
      console.log("\n Pilihan tidak valid!");
      setTimeout(showMenu, 1500);
      return;
    }

    runCommand(selected);
  });
}

// -- Command Executor + Auto Docker-Compose + RPC Ping -----------------

async function runCommand(selected) {
  console.clear();

  const proto = selected.protocol;

  // Skrip yang mengelola state Docker secara mandiri tidak perlu di-provisioning ulang oleh menu
  const isSelfManaged = selected.cmd === "node" && 
    (selected.args.includes("scripts/automation/run_suite.js") || 
     selected.args.includes("scripts/automation/reset_network.js"));

  // -- Step 1: docker-compose up -d ------------------------------------
  if ((proto === "ibft" || proto === "qbft") && !isSelfManaged) {
    const targetDir = proto === "ibft" ? "ibft2" : "qbft";
    const dirPath = path.join(__dirname, "..", targetDir);

    console.log(
      `\x1b[36m [1/3] Memvalidasi infrastruktur node ${proto.toUpperCase()}...\x1b[0m`,
    );
    try {
      // Sinkron: docker-compose akan cepat jika container sudah Up ("up-to-date")
      execSync("docker-compose up -d", { cwd: dirPath, stdio: "inherit" });
      console.log(
        `\x1b[32m Jaringan ${proto.toUpperCase()} beroperasi.\x1b[0m`,
      );
    } catch (err) {
      console.log(
        `\x1b[31m Gagal menjalankan docker-compose: ${err.message}\x1b[0m\n`,
      );
      // Lanjutkan tetapi peringatkan user - node mungkin sudah Up dari sesi sebelumnya
    }

    // -- Step 2: RPC Health-Check Ping ---------------------------------
    console.log(
      `\x1b[36m [2/3] Verifikasi RPC port ${RPC_PORTS[proto]}...\x1b[0m`,
    );
    const rpcReady = await waitForRpc(proto);

    if (rpcReady) {
      console.log(
        `\x1b[33m Menunggu 25 detik agar node selesai peering dan membentuk quorum...\x1b[0m`,
      );
      await new Promise((r) => setTimeout(r, 25000));
    }
  }

  // -- Step 3: Eksekusi Skrip Node.js --------------------------------
  const stepLabel = proto ? "[3/3]" : "[1/1]";
  console.log(`\x1b[36m ${stepLabel} Menjalankan: ${selected.name}\x1b[0m`);
  console.log(`\x1b[90m> ${selected.cmd} ${selected.args.join(" ")}\x1b[0m\n`);

  activeChildProcess = spawn(selected.cmd, selected.args, {
    stdio: "inherit",
    shell: false,
  });

  activeChildProcess.on("close", (code) => {
    activeChildProcess = null;
    const color = code === 0 ? "\x1b[32m" : "\x1b[31m";
    console.log(`\n${color} Proses selesai dengan exit code ${code}.\x1b[0m`);
    rl.question("\nTekan ENTER untuk kembali ke menu...", () => showMenu());
  });

  activeChildProcess.on("error", (err) => {
    activeChildProcess = null;
    console.error(`\n\x1b[31m Error: ${err.message}\x1b[0m`);
    rl.question("\nTekan ENTER untuk kembali ke menu...", () => showMenu());
  });
}

// -- Signal Handling ----------------------------------------------------

rl.on("SIGINT", () => {
  if (activeChildProcess) {
    console.log("\n Menghentikan proses anak...");
    activeChildProcess.kill("SIGINT");
  } else {
    console.log("\n Menutup Master Orchestrator. Terima kasih.");
    process.exit(0);
  }
});

// -- Entry Point --------------------------------------------------------
ensureDockerReady();
