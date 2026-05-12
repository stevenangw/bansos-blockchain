/**
 * scripts/automation/setup.js - Deploy, Whitelist & Fund
 *
 * Dijalankan setelah reset_network.js. Script ini:
 * 1. Deploy kontrak BansosToken ke jaringan yang sudah fresh.
 * 2. Whitelist & mint token ke setiap sender wallet.
 * 3. Transfer ETH ke setiap sender wallet (untuk gas fee benchmark).
 * 4. Whitelist setiap receiver address.
 *
 * PENTING: Script ini keluar dengan code 1 jika gagal, sehingga
 * run_suite.js akan berhenti dan tidak melanjutkan ke benchmark
 * dengan wallet yang tidak terfund.
 */

"use strict";

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const config = require("../utils/config");

// -- Helpers -------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function logStep(step, total, msg) {
  log(`\n  \x1b[36m[${step}/${total}]\x1b[0m ${msg}`);
}

/**
 * Tunggu provider benar-benar siap menerima eth_blockNumber.
 * Besu kadang menerima TCP tapi masih inisialisasi chain.
 */
async function waitForProvider(provider, maxRetries = 60, intervalMs = 2000) {
  log(`  \x1b[90m Menunggu node RPC siap...\x1b[0m`);
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const bn = await provider.getBlockNumber();
      log(`  \x1b[32m Node siap - Block #${bn}\x1b[0m`);
      return true;
    } catch {
      process.stdout.write(
        `\r   Percobaan ${i}/${maxRetries} - node belum siap...   `,
      );
      await sleep(intervalMs);
    }
  }
  process.stdout.write("\n");
  throw new Error(`Node RPC tidak responsif setelah ${maxRetries} percobaan`);
}

// -- Main -----------------------------------------------------------------

async function main() {
  const protocol = process.argv[2];
  if (!protocol || !config.networks[protocol]) {
    console.error(
      "Gunakan argumen protokol: node scripts/setup.js <ibft|qbft>",
    );
    process.exit(1);
  }

  const networkConfig = config.networks[protocol];
  const privateKey = config.adminKeys[protocol];

  log(
    `\n\x1b[45m\x1b[37m  SETUP ${protocol.toUpperCase()} - Deploy & Fund \x1b[0m`,
  );
  log(`   RPC : ${networkConfig.rpcUrl}`);

  // -- Provider Setup --------------------------------------------------
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  provider.on("error", () => {}); // Silence background errors

  const wallet = new ethers.Wallet(privateKey, provider);

  // Tunggu node benar-benar siap (bukan hanya TCP ping)
  await waitForProvider(provider);

  // -- [1/4] Compile Check & Deploy -----------------------------------
  logStep(1, 4, "Deploy kontrak BansosToken...");
  const artifactPath = path.join(
    __dirname,
    "..",
    "..",
    "artifacts",
    "contracts",
    "BansosToken.sol",
    "BansosToken.json",
  );
  if (!fs.existsSync(artifactPath)) {
    log(
      "  \x1b[31m Artifact tidak ditemukan! Jalankan 'npx hardhat compile' terlebih dahulu.\x1b[0m",
    );
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet,
  );

  const contractDeploy = await factory.deploy();
  await contractDeploy.waitForDeployment();
  const contractAddress = await contractDeploy.getAddress();
  log(`  \x1b[32m BansosToken deployed  ${contractAddress}\x1b[0m`);

  // Simpan alamat kontrak ke file
  const addressesFile = path.join(config.logDir, "contract_addresses.json");
  let addresses = {};
  if (fs.existsSync(addressesFile)) {
    try {
      addresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
    } catch (_) {}
  }
  addresses[protocol] = contractAddress;
  if (!fs.existsSync(config.logDir))
    fs.mkdirSync(config.logDir, { recursive: true });
  fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));

  const contract = new ethers.Contract(
    contractAddress,
    config.abi.setup,
    wallet,
  );
  const senders = JSON.parse(fs.readFileSync(config.sendersFile, "utf8"));
  const receivers = JSON.parse(fs.readFileSync(config.receiversFile, "utf8"));
  let nonce = await wallet.getNonce();

  // -- [2/4] Whitelist & Mint Senders ----------------------------------
  logStep(2, 4, `Whitelist & mint ${senders.length} sender wallets...`);
  for (let i = 0; i < senders.length; i++) {
    const sender = senders[i];
    const short = sender.address.slice(0, 10) + "...";

    if (!(await contract.whitelist(sender.address))) {
      await contract.setWhitelist(sender.address, true, {
        nonce: nonce++,
        gasLimit: 100_000,
      });
    }
    const tx = await contract.mint(sender.address, config.tokenPerSender, {
      nonce: nonce++,
      gasLimit: 100_000,
    });
    await tx.wait();
    log(
      `  [${i + 1}/${
        senders.length
      }] ${short}  ${config.tokenPerSender.toLocaleString()} tokens`,
    );
  }

  // -- [3/4] Fund Senders dengan ETH -----------------------------------
  logStep(3, 4, `Transfer ETH ke ${senders.length} sender wallets...`);
  for (let i = 0; i < senders.length; i++) {
    const sender = senders[i];
    const short = sender.address.slice(0, 10) + "...";
    const tx = await wallet.sendTransaction({
      to: sender.address,
      value: ethers.parseEther(config.ethPerSender),
      nonce: nonce++,
      gasLimit: 21_000,
    });
    await tx.wait();
    log(`  [${i + 1}/${senders.length}] ${short}  ${config.ethPerSender} ETH`);
  }

  // -- [4/4] Whitelist Receivers (Batched) ------------------------------
  const BATCH_SIZE = 20;
  const BATCH_TIMEOUT = 90_000; // 90 detik timeout per batch konfirmasi
  const MAX_RETRIES = 5;        // Cegah infinite retry loop

  logStep(4, 4, `Whitelist ${receivers.length} receiver addresses (batch @${BATCH_SIZE})...`);
  let whitelisted = 0;
  let skipped = 0;
  let batchPending = [];

  for (let idx = 0; idx < receivers.length; idx++) {
    const receiver = receivers[idx];

    // Cek apakah sudah di-whitelist (skip jika iya)
    try {
      if (await contract.whitelist(receiver)) {
        skipped++;
        continue;
      }
    } catch {
      // Jika RPC gagal untuk cek, anggap belum di-whitelist dan lanjut kirim
    }

    // Kirim transaksi dengan retry terbatas (bukan infinite loop)
    let txSent = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !txSent; attempt++) {
      try {
        const tx = await contract.setWhitelist(receiver, true, {
          nonce: nonce++,
          gasLimit: 100_000,
        });
        batchPending.push(tx.wait());
        txSent = true;
        whitelisted++;
      } catch (err) {
        const msg = (err.message || "").toLowerCase();
        if (
          msg.includes("nonce") ||
          msg.includes("already") ||
          err.code === "BAD_DATA" ||
          err.code === "UNKNOWN_ERROR" ||
          err.code === "ECONNRESET"
        ) {
          // Re-sync nonce dari chain agar tidak desync
          nonce = await wallet.getNonce();
          await sleep(500 * attempt);
        } else {
          throw err;
        }

        if (attempt === MAX_RETRIES) {
          log(`  \x1b[33m  Skip receiver ${receiver.slice(0, 10)}... setelah ${MAX_RETRIES} retry gagal\x1b[0m`);
        }
      }
    }

    // Drain batch setiap BATCH_SIZE transaksi - cegah mempool overload
    if (batchPending.length >= BATCH_SIZE) {
      const batchNum = Math.ceil((whitelisted + skipped) / BATCH_SIZE);
      process.stdout.write(
        `\r   Batch #${batchNum} - konfirmasi ${batchPending.length} tx... (${idx + 1}/${receivers.length})   `,
      );

      // Tunggu konfirmasi DENGAN timeout per batch
      const batchResults = await Promise.race([
        Promise.allSettled(batchPending),
        sleep(BATCH_TIMEOUT).then(() => "TIMEOUT"),
      ]);

      if (batchResults === "TIMEOUT") {
        log(`\n  \x1b[33m  Batch #${batchNum} timeout setelah ${BATCH_TIMEOUT / 1000}s - melanjutkan...\x1b[0m`);
      }

      batchPending = [];
    }
  }

  // Drain sisa batch terakhir
  if (batchPending.length > 0) {
    process.stdout.write(
      `\r   Final batch - konfirmasi ${batchPending.length} tx sisa...                    `,
    );
    await Promise.race([
      Promise.allSettled(batchPending),
      sleep(BATCH_TIMEOUT).then(() => "TIMEOUT"),
    ]);
  }

  process.stdout.write("\n");
  log(
    `  \x1b[32m ${whitelisted} receiver baru di-whitelist (${skipped} sudah ada)\x1b[0m`,
  );

  log(
    `\n\x1b[32m SETUP ${protocol.toUpperCase()} SELESAI - Jaringan siap untuk benchmark.\x1b[0m\n`,
  );
}

main().catch((err) => {
  console.error(`\n\x1b[31m SETUP GAGAL: ${err.message}\x1b[0m`);
  process.exit(1); // KRITIS: exit code 1 agar run_suite.js berhenti
});
