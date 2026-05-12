require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const path = require("path");
const ROOT_DIR = path.join(__dirname, "..", "..");
const LOG_DIR = path.join(ROOT_DIR, "logs");

module.exports = {
  rootDir: ROOT_DIR,
  logDir: LOG_DIR,
  contractAddrFile: path.join(LOG_DIR, "contract_addr.txt"),
  sendersFile: path.join(LOG_DIR, "senders.json"),
  receiversFile: path.join(LOG_DIR, "receivers.json"),

  adminKeys: {
    ibft: process.env.PRIVATE_KEY || "0xc24478b01b1039a144a244779545eaedeb90295f5cd86198de1ed7d9404a36fe",
    qbft: process.env.PRIVATE_KEY || "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63",
  },

  // Alamat kontrak dinamis yang dihasilkan oleh setup.js
  get contractAddresses() {
    try {
      const data = require("fs").readFileSync(
        path.join(LOG_DIR, "contract_addresses.json"),
        "utf8",
      );
      return JSON.parse(data);
    } catch (err) {
      return {};
    }
  },

  networks: {
    ibft: {
      name: "IBFT 2.0",
      rpcUrl: process.env.IBFT_URL || "http://127.0.0.1:8545",
      dir: "ibft2",
      containerPrefix: "besu-ibft", // sesuai docker-compose container_name
    },
    qbft: {
      name: "QBFT",
      rpcUrl: process.env.QBFT_URL || "http://127.0.0.1:18545",
      dir: "qbft",
      containerPrefix: "besu-qbft", // sesuai docker-compose container_name
    },
  },
  nodeCount: 3,
  minPeers: 2,

  senderCount: 10,
  receiverCount: 200,
  tokenPerSender: 50_000_000,
  ethPerSender: "5",

  benchmark: {
    duration: 120, // detik pengukuran
    warmup: 30, // detik warmup (data tidak direkam)
    drainTimeout: 600_000,
    confirmTimeout: 600_000,
    cooldownBetweenRuns: 30_000,
    cooldownBetweenTps: 20_000,
    gasLimit: { transfer: 100_000 },
  },

  profiles: {
    baseline: {
      label: "Baseline",
      tpsTargets: [10, 25, 50, 75, 100, 150, 200],
      repetitions: 10,
      chaosType: "none",
    },
    chaos_latency: {
      label: "Chaos - Latency 200ms",
      tpsTargets: [25, 50, 100],
      repetitions: 5,
      chaosType: "latency",
      chaosTarget: "node1",
    },
    chaos_packetloss: {
      label: "Chaos - Packet Loss 1%",
      tpsTargets: [25, 50, 100],
      repetitions: 5,
      chaosType: "packetloss",
      chaosTarget: "node1",
    },
    chaos_combined: {
      label: "Chaos - Latency 200ms + Loss 1%",
      tpsTargets: [25, 50, 100],
      repetitions: 5,
      chaosType: "combined",
      chaosTarget: "node1",
    },
  },

  // Konfigurasi chaos injection (tc netem)
  chaos: {
    latency:    { delay: "200ms", jitter: "50ms" },
    packetloss: { loss: "1%" },
    combined:   { delay: "200ms", jitter: "50ms", loss: "1%" },
    stabilizeMs: 5000,  // waktu tunggu setelah inject chaos
  },

  abi: {
    transfer: ["function transfer(address to, uint256 amount) returns (bool)"],
    setup: [
      "function mint(address to, uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
      "function setWhitelist(address account, bool status)",
      "function whitelist(address) view returns (bool)",
    ],
  },

  monitor: { intervalMs: 10_000 },
};
