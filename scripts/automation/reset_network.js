/**
 * scripts/automation/reset_network.js - Safe Network Purger
 *
 * ARSITEKTUR KEAMANAN KRIPTOGRAFIS:
 * Skrip ini HANYA menghapus subdirektori DATABASE/ dan CACHES/ di dalam
 * masing-masing nodeX/data/. File `key` dan `key.pub` TIDAK PERNAH disentuh.
 *
 * Menghapus `key` akan menghancurkan identitas kriptografis validator secara
 * permanen dan memutus struktur RLP `extraData` pada genesis block, sehingga
 * memerlukan re-genesis penuh. Skrip ini dirancang untuk mencegah hal tersebut.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const RPC_PORTS = { ibft: 8545, qbft: 18545 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runCmd(cmd, args, cwd) {
  console.log(`\n\x1b[90m> ${cmd} ${args.join(" ")} (di ${cwd})\x1b[0m`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) {
    console.error(
      `\x1b[31m Gagal mengeksekusi: ${cmd} ${args.join(" ")}\x1b[0m`,
    );
  }
}

// -- TCP RPC Health-Check -----------------------------------------------

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

async function waitForRpc(protocol) {
  const port = RPC_PORTS[protocol];
  if (!port) return true;
  const deadline = Date.now() + 120000;
  let attempt = 0;
  console.log(`\n\x1b[36m Menunggu RPC port ${port} siap menerima koneksi...\x1b[0m`);
  while (Date.now() < deadline) {
    attempt++;
    if (await tcpPing("127.0.0.1", port, 3000)) {
      console.log(`\n\x1b[32m RPC port ${port} responsif setelah ${attempt} percobaan.\x1b[0m`);
      return true;
    }
    process.stdout.write(`\r   Percobaan #${attempt} - port ${port} belum terbuka. Retry dalam 3s...   `);
    await sleep(3000);
  }
  console.warn(`\n\x1b[33m  RPC port ${port} tidak responsif (Timeout 120s).\x1b[0m`);
  return false;
}

/**
 * Menghapus subdirektori target di dalam data/ secara selektif.
 * File key / key.pub di-preserve sepenuhnya.
 *
 * Struktur Besu data/:
 *   DATABASE/     database RocksDB, aman dihapus
 *   CACHES/       cache Besu, aman dihapus
 *   key           JANGAN HAPUS (identitas validator)
 *   key.pub       JANGAN HAPUS (public key validator)
 */
async function purgeNodeData(dataPath, nodeName) {
  // Direktori yang aman untuk dihapus (whitelist)
  const SAFE_TO_DELETE = ["DATABASE", "CACHES"];

  if (!fs.existsSync(dataPath)) {
    console.log(`  ℹ  Tidak ada: ${nodeName}/data (Sudah bersih)`);
    return;
  }

  let deletedAny = false;
  for (const subdir of SAFE_TO_DELETE) {
    const targetPath = path.join(dataPath, subdir);
    if (fs.existsSync(targetPath)) {
      let attempts = 0;
      let success = false;
      while (attempts < 5 && !success) {
        try {
          fs.rmSync(targetPath, { recursive: true, force: true });
          console.log(`   Terhapus: ${nodeName}/data/${subdir}`);
          deletedAny = true;
          success = true;
        } catch (err) {
          attempts++;
          if (attempts >= 5) {
            console.error(`   Gagal menghapus ${nodeName}/data/${subdir} setelah 5 percobaan: ${err.message}`);
          } else {
            console.warn(`    File terkunci (${err.code}), mencoba lagi dalam 1 detik...`);
            await sleep(1000);
          }
        }
      }
    } else {
      console.log(`  ℹ  Tidak ada: ${nodeName}/data/${subdir} (Sudah bersih)`);
    }
  }

  // Verifikasi bahwa key masih ada (safeguard audit)
  const keyPath = path.join(dataPath, "key");
  if (fs.existsSync(keyPath)) {
    console.log(`   Key validator terlindungi: ${nodeName}/data/key [OK]`);
  } else {
    console.warn(
      `    PERINGATAN: ${nodeName}/data/key tidak ditemukan - genesis extraData mungkin tidak valid!`,
    );
  }

  if (!deletedAny) {
    console.log(`  ℹ  ${nodeName}/data sudah bersih dari DATABASE dan CACHES`);
  }
}

async function resetNetwork(protocol) {
  console.log(
    `\n\x1b[45m\x1b[37m  MERESET JARINGAN: ${protocol.toUpperCase()} \x1b[0m`,
  );

  const rootDir = path.join(__dirname, "..", "..");
  const protocolDir =
    protocol === "ibft"
      ? path.join(rootDir, "ibft2")
      : path.join(rootDir, "qbft");

  if (!fs.existsSync(protocolDir)) {
    console.error(`\x1b[31m Folder ${protocolDir} tidak ditemukan!\x1b[0m`);
    process.exit(1);
  }

  // 1. Matikan Docker Containers (tanpa -v agar named volumes tidak ikut terhapus)
  console.log(
    `\n\x1b[36m 1. Mematikan node Docker (${protocol.toUpperCase()})...\x1b[0m`,
  );
  runCmd("docker", ["compose", "down"], protocolDir);

  // 2. Hapus HANYA DATABASE/ dan CACHES/ - key tetap aman
  console.log(
    `\n\x1b[36m 2. Membersihkan DATABASE dan CACHES (key validator di-preserve)...\x1b[0m`,
  );
  const nodes = ["node1", "node2", "node3"];
  for (const node of nodes) {
    const dataPath = path.join(protocolDir, node, "data");
    await purgeNodeData(dataPath, node);
  }

  // 3. Nyalakan ulang Docker Containers
  console.log(
    `\n\x1b[36m 3. Menyalakan ulang node Docker (${protocol.toUpperCase()})...\x1b[0m`,
  );
  runCmd("docker", ["compose", "up", "-d"], protocolDir);

  // 4. Jeda untuk recovery & genesis sync
  const isReady = await waitForRpc(protocol);
  if (isReady) {
    console.log(
      `\x1b[33m Menunggu 25 detik ekstra agar node selesai peering & genesis sync...\x1b[0m`,
    );
    await sleep(25000);
  }

  console.log(
    `\n\x1b[32m JARINGAN ${protocol.toUpperCase()} BERHASIL DI-RESET - Key validator aman!\x1b[0m\n`,
  );
}

async function main() {
  const target = process.argv[2];

  if (!target || !["ibft", "qbft", "all"].includes(target.toLowerCase())) {
    console.error(
      "Gunakan argumen target: node reset_network.js <ibft|qbft|all>",
    );
    process.exit(1);
  }

  if (target === "ibft" || target === "all") {
    await resetNetwork("ibft");
  }

  if (target === "qbft" || target === "all") {
    await resetNetwork("qbft");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
