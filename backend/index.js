require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// -- Environment Validation ------------------------------------------------
const REQUIRED_ENV = ["PORT"]; // Removed PROVIDER_URL and PRIVATE_KEY to allow fallback
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev")); // Request/response logger

// Request Timeout Middleware
app.use((req, res, next) => {
  req.setTimeout(10000, () => {
    res.status(408).json({ error: "Waktu permintaan habis (Request Timeout)." });
  });
  next();
});

// -- Blockchain Initialization ---------------------------------------------
let provider;
let wallet;
let contract;
let distributors = [];
let CONTRACT_ADDRESS = "";
let PROVIDER_URL = "";
let NETWORK_NAME = "";

function parseRevertReason(error) {
  const message = error.message || "";
  const reason = error.reason || "";
  const fullText = (message + " " + reason).toLowerCase();

  // Ethers specific errors
  if (fullText.includes("bad address checksum")) return "Format alamat (checksum) tidak valid. Pastikan penulisan huruf besar/kecil alamat benar.";
  if (fullText.includes("invalid address") || fullText.includes("invalid argument=\"address\"")) return "Alamat tidak valid. Pastikan alamat diawali 0x dan memiliki panjang yang tepat.";
  
  // Smart Contract errors
  if (fullText.includes("penerima tidak terdaftar di whitelist")) return "Penerima belum terdaftar dalam whitelist.";
  if (fullText.includes("saldo tidak cukup") || fullText.includes("insufficient funds")) return "Saldo token tidak mencukupi untuk transaksi ini.";
  if (fullText.includes("hanya admin")) return "Akses ditolak: Hanya admin yang dapat melakukan aksi ini.";
  if (fullText.includes("transfer dari alamat nol")) return "Alamat pengirim tidak valid (alamat nol).";
  if (fullText.includes("transfer ke alamat nol")) return "Alamat penerima tidak valid (alamat nol).";
  if (fullText.includes("allowance tidak mencukupi")) return "Jatah transfer (allowance) tidak mencukupi.";
  if (fullText.includes("execution reverted")) return "Transaksi dibatalkan oleh smart contract.";
  
  return "Terjadi kesalahan sistem: " + (error.reason || error.message || "Unknown error");
}

// -- Custom Readable Logger ------------------------------------------------
const logger = {
  info: (msg, meta = {}) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\x1b[36m[${timestamp}] INFO:\x1b[0m ${msg}`);
    if (Object.keys(meta).length > 0) {
      console.log(`   \x1b[90mDetails: ${JSON.stringify(meta)}\x1b[0m`);
    }
  },
  warn: (msg, meta = {}) => {
    const timestamp = new Date().toLocaleTimeString();
    console.warn(`\x1b[33m[${timestamp}] WARN:\x1b[0m ${msg}`);
    if (Object.keys(meta).length > 0) {
      console.warn(`   \x1b[90mDetails: ${JSON.stringify(meta)}\x1b[0m`);
    }
  },
  error: (msg, meta = {}) => {
    const timestamp = new Date().toLocaleTimeString();
    console.error(`\n\x1b[31m[${timestamp}] ERROR: ${msg}\x1b[0m`);
    if (meta.route) console.error(`   \x1b[90mRoute:\x1b[0m  ${meta.route}`);
    if (meta.message) console.error(`   \x1b[90mReason:\x1b[0m ${meta.message}`);
    
    if (meta.stack) {
      console.error(`   \x1b[90mStack Trace (top 3):\x1b[0m`);
      const stackLines = meta.stack.split('\n').slice(0, 3);
      stackLines.forEach(line => console.error(`     \x1b[90m${line.trim()}\x1b[0m`));
    }

    const extras = { ...meta };
    delete extras.route; delete extras.message; delete extras.stack;
    if (Object.keys(extras).length > 0) {
      console.error(`   \x1b[90mMetadata:\x1b[0m`, extras);
    }
    console.error(''); // Extra newline for readability
  },
};

async function initBlockchain() {
  const CHAIN_ID = 1337;
  const besuNetwork = ethers.Network.from(CHAIN_ID);

  const networks = [
    {
      name: "QBFT",
      url: process.env.QBFT_URL || "http://127.0.0.1:18545",
      key: process.env.QBFT_PRIVATE_KEY || "8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63",
      id: "qbft",
    },
    {
      name: "IBFT 2.0",
      url: process.env.IBFT_URL || "http://127.0.0.1:8545",
      key: process.env.IBFT_PRIVATE_KEY || "c24478b01b1039a144a244779545eaedeb90295f5cd86198de1ed7d9404a36fe",
      id: "ibft",
    },
  ];

  let activeNetwork = null;
  for (const net of networks) {
    try {
      const tempProvider = new ethers.JsonRpcProvider(net.url, besuNetwork, { staticNetwork: besuNetwork });
      const blockNumber = await tempProvider.getBlockNumber();
      activeNetwork = net;
      logger.info(`Berhasil terhubung ke jaringan ${net.name}`, { blockNumber, url: net.url });
      break;
    } catch (e) {
      // Abaikan jika tidak connect
    }
  }

  if (!activeNetwork) {
    logger.error("Tidak mendeteksi jaringan lokal yang hidup. Pastikan node berjalan.");
    process.exit(1);
  }

  PROVIDER_URL = activeNetwork.url;
  NETWORK_NAME = activeNetwork.name;

  provider = new ethers.JsonRpcProvider(PROVIDER_URL, besuNetwork, { staticNetwork: besuNetwork });
  wallet = new ethers.Wallet(activeNetwork.key, provider);

  // Load contract address
  try {
    const addressesFile = path.join(__dirname, "..", "logs", "contract_addresses.json");
    if (fs.existsSync(addressesFile)) {
      const addresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
      CONTRACT_ADDRESS = addresses[activeNetwork.id];
      if (CONTRACT_ADDRESS) {
        logger.info("Alamat kontrak berhasil dimuat", { address: CONTRACT_ADDRESS, network: activeNetwork.name });
      } else {
        logger.warn("Alamat kontrak tidak ditemukan di file untuk jaringan aktif.");
      }
    }
  } catch (e) {
    logger.warn("Gagal membaca contract_addresses.json", { error: e.message });
  }

  // Load distributors
  try {
    const sendersFile = path.join(__dirname, "..", "logs", "senders.json");
    if (fs.existsSync(sendersFile)) {
      const rawData = JSON.parse(fs.readFileSync(sendersFile, "utf8"));
      distributors = rawData.map((d, index) => ({
        name: `Bank Penyalur ${index + 1}`,
        address: d.address,
        privateKey: d.privateKey,
      }));
      logger.info("Distributor berhasil dimuat", { count: distributors.length });
    }
  } catch (e) {
    logger.warn("Gagal membaca senders.json", { error: e.message });
  }

  const abi = [
    "function admin() view returns (address)",
    "function setWhitelist(address account, bool status)",
    "function whitelist(address) view returns (bool)",
    "function mint(address to, uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function totalSupply() view returns (uint256)",
    "event WhitelistUpdated(address indexed account, bool status)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ];

  contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
}

// ==================== API ENDPOINTS ====================

app.get("/api/distributors", (req, res, next) => {
  try {
    res.json(distributors.map((d) => ({ name: d.name, address: d.address })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/info", async (req, res, next) => {
  try {
    const [adminAddr, totalSupply, blockNumber] = await Promise.all([
      contract.admin(),
      contract.totalSupply(),
      provider.getBlockNumber(),
    ]);
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      admin: adminAddr,
      totalSupply: totalSupply.toString(),
      providerUrl: PROVIDER_URL,
      network: NETWORK_NAME,
      blockNumber,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/balance/:address", async (req, res, next) => {
  try {
    const balance = await contract.balanceOf(req.params.address);
    res.json({ address: req.params.address, balance: balance.toString() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/whitelist/:address", async (req, res, next) => {
  try {
    const status = await contract.whitelist(req.params.address);
    res.json({ address: req.params.address, whitelisted: status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/whitelists", async (req, res, next) => {
  try {
    const filter = contract.filters.WhitelistUpdated();
    const events = await contract.queryFilter(filter, 0, "latest");

    const whitelistMap = {};
    for (const event of events) {
      const { account, status } = event.args;
      whitelistMap[account] = status;
    }

    const distAddresses = distributors.map((d) => d.address.toLowerCase());
    const whitelists = Object.keys(whitelistMap).map((address) => {
      const isDistributor = distAddresses.includes(address.toLowerCase());
      return {
        address,
        status: whitelistMap[address],
        role: isDistributor ? "Bank Penyalur" : "KPM",
      };
    });

    res.json(whitelists);
  } catch (error) {
    next(error);
  }
});

app.post("/api/whitelist", async (req, res, next) => {
  try {
    const { address, status } = req.body;
    if (!address) return res.status(400).json({ error: "Address wajib diisi" });
    
    const tx = await contract.setWhitelist(address, status);
    const receipt = await tx.wait();
    res.json({
      success: true,
      address,
      status,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/mint", async (req, res, next) => {
  try {
    const { to, amount } = req.body;
    if (!to || !amount) return res.status(400).json({ error: "Address dan jumlah wajib diisi" });
    
    const tx = await contract.mint(to, parseInt(amount));
    const receipt = await tx.wait();
    res.json({
      success: true,
      to,
      amount: parseInt(amount),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/transfer", async (req, res, next) => {
  try {
    const { senderAddress, to, amount } = req.body;
    if (!to || !amount || !senderAddress) {
      return res.status(400).json({ error: "senderAddress, to, dan amount wajib diisi" });
    }

    const dist = distributors.find((d) => d.address.toLowerCase() === senderAddress.toLowerCase());
    if (!dist) return res.status(404).json({ error: "Bank Penyalur tidak ditemukan di backend" });

    const senderWallet = new ethers.Wallet(dist.privateKey, provider);
    const senderContract = contract.connect(senderWallet);

    const tx = await senderContract.transfer(to, parseInt(amount));
    const receipt = await tx.wait();
    res.json({
      success: true,
      sender: senderAddress,
      to,
      amount: parseInt(amount),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history/:address", async (req, res, next) => {
  try {
    const addr = req.params.address;
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 5000);

    const filterFrom = contract.filters.Transfer(addr, null);
    const filterTo = contract.filters.Transfer(null, addr);

    const [eventsFrom, eventsTo] = await Promise.all([
      contract.queryFilter(filterFrom, fromBlock, currentBlock),
      contract.queryFilter(filterTo, fromBlock, currentBlock),
    ]);

    const allEvents = [...eventsFrom, ...eventsTo]
      .map((e) => ({
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        from: e.args[0],
        to: e.args[1],
        amount: e.args[2].toString(),
        type: e.args[0].toLowerCase() === addr.toLowerCase() ? "OUT" : "IN",
      }))
      .sort((a, b) => b.blockNumber - a.blockNumber)
      .slice(0, 50);

    res.json({ address: addr, transactions: allEvents });
  } catch (error) {
    next(error);
  }
});

// -- Global Error Handler Middleware ---------------------------------------
app.use((err, req, res, next) => {
  const userMessage = parseRevertReason(err);
  
  // Log the error neatly in the terminal
  logger.error(userMessage, { 
    route: req.originalUrl, 
    message: err.message, 
    stack: err.stack 
  });

  res.status(500).json({ 
    error: userMessage, 
    details: err.message,
    route: req.originalUrl 
  });
});

const PORT = process.env.PORT || 4000;
initBlockchain().then(() => {
  app.listen(PORT, () => {
    logger.info(`Backend Bansos berjalan di port ${PORT}`, { port: PORT });
  });
});

// Keep alive (opsional)
setInterval(() => {}, 1000);
