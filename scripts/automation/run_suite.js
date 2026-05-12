const { spawn } = require("child_process");
const config = require("../utils/config");

async function runCommand(cmd, args, description) {
  return new Promise((resolve, reject) => {
    if (description) {
      console.log(`\n\x1b[36m ${description}\x1b[0m`);
    } else {
      console.log(`\n\x1b[90m Menjalankan: ${cmd} ${args.join(" ")}\x1b[0m`);
    }

    // shell: false menghilangkan pesan DeprecationWarning DEP0190
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Proses gagal dengan exit code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function runSuiteForProtocol(protocol, specificProfile = null) {
  console.log(
    `\n\x1b[45m\x1b[37m  MEMULAI TEST SUITE: ${protocol.toUpperCase()} \x1b[0m`,
  );
  try {
    // 1 & 2. Looping per Profile (Setiap profil mulai dari kondisi FRESH / Block 0)
    let profiles = [
      "baseline",
      "chaos_latency",
      "chaos_packetloss",
      "chaos_combined"
    ];
    
    if (specificProfile) {
      if (!profiles.includes(specificProfile)) {
        throw new Error(`Profile tidak valid: ${specificProfile}`);
      }
      profiles = [specificProfile];
    }
    for (const profile of profiles) {
      console.log(
        `\n\x1b[44m\x1b[37m  MEMPERSIAPKAN LINGKUNGAN UNTUK PROFIL: ${profile.toUpperCase()} \x1b[0m`,
      );

      // A. Deep Reset (Otomatis docker-compose down/up & tunggu RPC siap)
      await runCommand(
        "node",
        ["scripts/automation/reset_network.js", protocol],
        `Mereset jaringan agar kembali ke Block 0 untuk ${profile}`,
      );

      // B. Setup (Deploy kontrak baru, isi saldo & whitelist di jaringan yang baru di-reset)
      await runCommand(
        "node",
        ["scripts/automation/setup.js", protocol],
        `Setup jaringan dan whitelisting untuk ${profile}`,
      );

      // C. Mulai Benchmark Profil Tersebut
      await runCommand(
        "node",
        [
          "--max-old-space-size=8192",
          "--expose-gc",
          "scripts/core/orchestrator.js",
          protocol,
          profile,
        ],
        `Eksekusi Benchmark: ${profile}`,
      );
    }

    console.log(
      `\n\x1b[32m TEST SUITE ${protocol.toUpperCase()} SELESAI.\x1b[0m\n`,
    );
  } catch (err) {
    console.error(`\n\x1b[31m TEST SUITE GAGAL: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

async function main() {
  const target = process.argv[2];
  const specificProfile = process.argv[3]; // Opsional, e.g. "baseline" atau "chaos_latency"

  if (!target || !["ibft", "qbft", "all"].includes(target.toLowerCase())) {
    console.error(
      "Gunakan argumen target: node scripts/run_suite.js <ibft|qbft|all> [profile]",
    );
    process.exit(1);
  }

  if (target === "ibft" || target === "all") {
    await runSuiteForProtocol("ibft", specificProfile);
  }

  if (target === "qbft" || target === "all") {
    if (target === "all") {
      console.log(
        `\n\x1b[33m Cooldown 10 detik sebelum berpindah protokol...\x1b[0m`,
      );
      await new Promise((r) => setTimeout(r, 10000));
    }
    await runSuiteForProtocol("qbft", specificProfile);
  }

  // 3. Analisis Hasil Akhir
  await runCommand(
    "node",
    ["scripts/automation/analyze.js"],
    "Menganalisis hasil benchmark",
  );

  console.log(
    `\n\x1b[42m\x1b[30m  SELURUH TEST SUITE SELESAI DENGAN SUKSES!  \x1b[0m\n`,
  );
}

main();
