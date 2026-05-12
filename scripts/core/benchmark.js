/**
 * scripts/core/benchmark.js - Core Transaction Worker
 */

"use strict";

const { ethers } = require("ethers");
const fs = require("fs");
const http = require("http");
const config = require("../utils/config");

try {
  const { setGlobalDispatcher, Agent } = require("undici");
  setGlobalDispatcher(new Agent({ 
    connections: 250,
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 30000 
  }));
} catch (e) {}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) { process.stdout.write(`${msg}\n`); }

// Menekan pesan "Unhandled rejection: request timeout" dari ethers.js
// yang muncul saat drain phase - sudah di-handle oleh Promise.race di bawah
process.on("unhandledRejection", (reason) => {
  const msg = (reason?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("econnrefused")) return;
  console.error("\n  Unhandled rejection:", reason);
});

const c = {
  dim: (m) => `\x1b[90m${m}\x1b[0m`,
  green: (m) => `\x1b[32m${m}\x1b[0m`,
  yellow: (m) => `\x1b[33m${m}\x1b[0m`,
  red: (m) => `\x1b[31m${m}\x1b[0m`,
  cyan: (m) => `\x1b[36m${m}\x1b[0m`,
};

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function runBenchmark(protocol, tpsTarget) {
  const net = config.networks[protocol];
  const { warmup, duration, drainTimeout, gasLimit } = config.benchmark;

  const fetchReq = new ethers.FetchRequest(net.rpcUrl);
  fetchReq.agent = new http.Agent({ keepAlive: true, maxSockets: 250 });
  const provider = new ethers.JsonRpcProvider(fetchReq, undefined, { staticNetwork: true, batchMaxCount: 1 });
  provider.on("error", () => {});

  const contractAddr = config.contractAddresses[protocol];
  const senders   = JSON.parse(fs.readFileSync(config.sendersFile, "utf8"));
  const receivers = JSON.parse(fs.readFileSync(config.receiversFile, "utf8"));
  const wallets   = senders.map((s) => new ethers.Wallet(s.privateKey, provider));
  const iface     = new ethers.Interface(config.abi.transfer);

  log(c.cyan(`\n BENCHMARK: ${net.name} | Target: ${tpsTarget} TPS | Wallets: ${wallets.length}`));

  let ready = false;
  while (!ready) {
    try { await provider.getBlockNumber(); ready = true; }
    catch { await sleep(1000); }
  }

  const networkInfo = await provider.getNetwork();
  const feeData    = await provider.getFeeData();
  const gasPrice   = feeData.gasPrice || 1_000_000_000n;

  const nonces = await Promise.all(wallets.map((w) => provider.getTransactionCount(w.address, "pending")));

  const totalTx = tpsTarget * (warmup + duration + 5);
  process.stdout.write(c.dim(`  * Pre-signing ${totalTx} transactions... `));

  const descriptors = [];
  for (let i = 0; i < totalTx; i++) {
    const wIdx = i % wallets.length;
    descriptors.push({
      wIdx,
      tx: {
        to: contractAddr,
        data: iface.encodeFunctionData("transfer", [receivers[i % receivers.length], 1]),
        nonce: nonces[wIdx]++,
        gasLimit: gasLimit.transfer,
        gasPrice,
        chainId: networkInfo.chainId,
      },
    });
  }

  const payloads = [];
  for (const batch of chunkArray(descriptors, Math.max(wallets.length, 10))) {
    const signed = await Promise.all(batch.map(({ wIdx, tx }) => wallets[wIdx].signTransaction(tx)));
    payloads.push(...signed);
  }
  log(c.green("OK"));

  let payloadIndex = 0;
  const pendingReceipts = [];
  let txSent = 0;
  let drainDone = false;
  let loggedErr = false;

  const sendWithRetry = async (rawTx) => {
    let lastErr;
    for (let i = 1; i <= 3; i++) {
      try {
        return await provider.broadcastTransaction(rawTx);
      } catch (err) {
        lastErr = err;
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("known") || msg.includes("nonce too low") || msg.includes("already used") || msg.includes("already been used")) {
          return { wait: async () => ({ status: 1, hash: "already_known" }) };
        }
        if (msg.includes("exceeds account balance")) throw err;
        await sleep(100 * i);
      }
    }
    throw lastErr;
  };

  async function broadcastBatch(tps, isMeasurement) {
    const promises = [];
    for (let i = 0; i < tps; i++) {
      if (payloadIndex >= payloads.length) break;
      const rawTx = payloads[payloadIndex++];
      const sendTime = Date.now();

      const p = sendWithRetry(rawTx)
        .then((resp) => {
          if (!isMeasurement) return;
          txSent++;
          const safeWait = resp.wait()
            .then((r) => (drainDone ? { ok: false } : { ok: true, hash: r.hash, confirmTime: Date.now() }))
            .catch(() => ({ ok: false }));
          pendingReceipts.push({ sendTime, receiptPromise: safeWait });
        })
        .catch((err) => {
          if (isMeasurement && !loggedErr) {
            loggedErr = true;
            log(c.yellow(`  ! Info: Broadcast reject sample -> ${err.message.split('\n')[0].substring(0, 80)}`));
          }
          if (isMeasurement) {
            txSent++;
            pendingReceipts.push({ sendTime, receiptPromise: Promise.resolve({ ok: false }) });
          }
        });
      promises.push(p);
    }
    await Promise.all(promises);
  }

  log(c.dim(`  * Phase: Warmup (${warmup}s)...`));
  const warmupEnd = Date.now() + warmup * 1000;
  while (Date.now() < warmupEnd) {
    const tick = Date.now();
    await broadcastBatch(tpsTarget, false);
    const elapsed = Date.now() - tick;
    if (elapsed < 1000) await sleep(1000 - elapsed);
  }

  txSent = 0;
  pendingReceipts.length = 0;
  loggedErr = false;

  log(c.dim(`  * Phase: Measurement (${duration}s)...`));
  const measureStart = Date.now();
  const measureEnd = measureStart + duration * 1000;

  while (Date.now() < measureEnd) {
    const tick = Date.now();
    await broadcastBatch(tpsTarget, true);
    const elapsed = Date.now() - tick;
    if (elapsed < 1000) await sleep(1000 - elapsed);
  }

  const actualDuration = (Date.now() - measureStart) / 1000;

  log(c.dim(`  * Phase: Drain (waiting for ${txSent} txs to confirm)...`));
  const results = await Promise.all(
    pendingReceipts.map((p) => {
      // Setiap receipt mendapat timeout INDIVIDU (bukan shared global timer)
      const perTxDeadline = sleep(drainTimeout).then(() => ({ ok: false, timeout: true }));
      return Promise.race([p.receiptPromise, perTxDeadline]).then((res) => ({
        sendTime: p.sendTime,
        confirmTime: res.confirmTime || Date.now(),
        ...res,
      }));
    })
  );
  drainDone = true;

  const okResults = results.filter((r) => r.ok);
  const txOk = okResults.length;
  const txFail = results.length - txOk;
  const latencies = okResults.map((r) => r.confirmTime - r.sendTime).sort((a, b) => a - b);
  
  const throughput = actualDuration > 0 ? parseFloat((txOk / actualDuration).toFixed(2)) : 0;
  const latencyMean = latencies.length > 0 ? parseFloat((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0;
  const latencyP50 = percentile(latencies, 50);
  const latencyP95 = percentile(latencies, 95);

  const tpsColor = throughput >= tpsTarget * 0.8 ? c.green : throughput > 0 ? c.yellow : c.red;
  
  log(`  ${c.green("")} Result: ${tpsColor(`${throughput} TPS`)} | OK: ${txOk}, Fail: ${txFail} | Latency P50: ${latencyP50}ms`);

  await sleep(100);
  provider.destroy();
  if (fetchReq.agent && typeof fetchReq.agent.destroy === "function") {
    fetchReq.agent.destroy();
  }

  return {
    tps_target: tpsTarget,
    tx_sent: txSent,
    tx_ok: txOk,
    tx_fail: txFail,
    throughput,
    latency_mean: latencyMean,
    latency_p50: latencyP50,
    latency_p95: latencyP95,
    latency_p99: percentile(latencies, 99),
  };
}

module.exports = { runBenchmark };
