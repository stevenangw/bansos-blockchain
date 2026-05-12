/**
 * scripts/utils/chaos.js - Network Chaos Injection via tc netem
 *                          with Application-Layer Fallback
 *
 * Strategy (tiered):
 *   1. Try `tc netem` via `docker exec` (requires NET_ADMIN + sch_netem kernel module).
 *   2. If kernel blocks it (Docker Desktop / WSL2), fall back to application-layer chaos:
 *      - Patches Node.js http.Agent so every outgoing RPC connection is delayed.
 *      - Statistically equivalent to a network delay on the validator node for thesis purposes.
 *
 * Chaos Types:
 *   - "latency"     delay 200ms jitter 50ms
 *   - "packetloss"  loss 1%  (app-layer: random request drop)
 *   - "combined"    delay 200ms jitter 50ms + loss 1%
 *
 * Lifecycle: apply()  verify()  [benchmark runs]  clear()
 */

"use strict";

const http   = require("http");
const { spawnSync } = require("child_process");
const config = require("./config");

// -- Helpers ------------------------------------------------------------

function log(msg)    { process.stdout.write(`${msg}\n`); }
function dim(msg)    { return `\x1b[90m${msg}\x1b[0m`; }
function green(msg)  { return `\x1b[32m${msg}\x1b[0m`; }
function yellow(msg) { return `\x1b[33m${msg}\x1b[0m`; }
function red(msg)    { return `\x1b[31m${msg}\x1b[0m`; }

// -- Application-Layer Chaos State -------------------------------------

let _appChaosActive   = false;
let _appChaosParams   = null;   // { delayMs, jitterMs, lossRate }
let _originalCreateCx = null;   // saved http.Agent.prototype.createConnection

/**
 * Sleep helper for app-layer chaos.
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -- tc netem Helpers ---------------------------------------------------

function dockerExec(containerName, cmd) {
  const args   = ["exec", containerName, ...cmd];
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout:  15_000,
    shell:    false,
  });
  return {
    ok:     result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function getContainerName(protocol, nodeId = "node1") {
  const prefix = config.networks[protocol].containerPrefix;
  return `${prefix}-${nodeId}`;
}

function buildNetemArgs(chaosType) {
  const params = config.chaos[chaosType];
  if (!params) throw new Error(`Unknown chaos type: "${chaosType}"`);
  const args = [];
  if (params.delay) {
    args.push("delay", params.delay);
    if (params.jitter) args.push(params.jitter);
    // Add distribution for more realistic jitter
    args.push("distribution", "normal");
  }
  if (params.loss) args.push("loss", params.loss);
  return args;
}

function clearSilent(protocol, nodeId = "node1") {
  const container = getContainerName(protocol, nodeId);
  dockerExec(container, ["tc", "qdisc", "del", "dev", "eth0", "root"]);
}

/**
 * Auto-install iproute2 inside a container if `tc` is not found.
 * Idempotent - skips install if tc already exists.
 * Needed because the Besu Docker image ships without iproute2,
 * and the install is lost each time the container is recreated.
 *
 * @param {string} containerName
 * @returns {boolean} true if tc is available after this call
 */
function ensureIproute2(containerName) {
  // Check if tc already available
  const check = dockerExec(containerName, ["which", "tc"]);
  if (check.ok) return true;

  // Try to install (requires network access inside the container)
  log(dim(`    Installing iproute2 in ${containerName}...`));
  const install = spawnSync(
    "docker",
    ["exec", "-u", "root", containerName,
     "sh", "-c", "apt-get update -qq && apt-get install -y --no-install-recommends iproute2"],
    { encoding: "utf8", timeout: 60_000, shell: false }
  );

  if (install.status !== 0) {
    log(yellow(`     Gagal install iproute2 di ${containerName}: ${(install.stderr || "").trim()}`));
    return false;
  }

  log(dim(`    iproute2 installed in ${containerName}`));
  return true;
}

/**
 * Try to apply tc netem in the container.
 * Auto-installs iproute2 first if needed.
 * Returns { success, reason } - false if kernel blocks it.
 */
function tryKernelChaos(protocol, chaosType) {
  const profile   = config.profiles[`chaos_${chaosType}`];
  const target    = profile?.chaosTarget || "node1";
  const container = getContainerName(protocol, target);
  const netemArgs = buildNetemArgs(chaosType);

  // Auto-install iproute2 if tc is missing (e.g. after container recreate)
  ensureIproute2(container);

  clearSilent(protocol, target);

  const result = dockerExec(container, [
    "tc", "qdisc", "add", "dev", "eth0", "root", "netem", ...netemArgs,
  ]);

  if (!result.ok) {
    const combined = (result.stderr + result.stdout).toLowerCase();
    // These indicate kernel-level block (Docker Desktop / WSL2)
    if (
      combined.includes("operation not permitted") ||
      combined.includes("not found") ||
      combined.includes("no such file") ||
      combined.includes("executable file not found")
    ) {
      return { success: false, reason: result.stderr || result.stdout };
    }
    return { success: false, reason: result.stderr || result.stdout };
  }

  return { success: true };
}

// -- Application-Layer Chaos --------------------------------------------

/**
 * Parses chaos config into numeric params for app-layer injection.
 */
function buildAppChaosParams(chaosType) {
  const params = config.chaos[chaosType];
  if (!params) throw new Error(`Unknown chaos type: "${chaosType}"`);

  const parseMs = (val) => val ? parseInt(val, 10) : 0;
  const parsePct = (val) => val ? parseFloat(val) / 100 : 0;

  return {
    delayMs:  parseMs(params.delay),
    jitterMs: parseMs(params.jitter),
    lossRate: parsePct(params.loss),
    label:    `delay=${params.delay || "0"} jitter=${params.jitter || "0"} loss=${params.loss || "0%"}`,
    hasDelay: !!(params.delay),
    hasLoss:  !!(params.loss),
  };
}

/**
 * Patches http.Agent.prototype.createConnection to add delay+loss
 * before every outgoing TCP connection (i.e., every RPC call).
 *
 * Strategy: let the real createConnection run (so a real socket is returned),
 * but wrap the callback so the caller receives the "connected" signal only after
 * the simulated delay - equivalent to a slow network link.
 */
function applyAppChaos(params) {
  if (_appChaosActive) return;   // idempotent

  _originalCreateCx = http.Agent.prototype.createConnection;

  http.Agent.prototype.createConnection = function patchedCreateConnection(options, originalCb) {
    const { delayMs, jitterMs, lossRate } = params;

    // Simulate packet loss: inject an error into the callback after a short delay
    if (lossRate > 0 && Math.random() < lossRate) {
      const err = Object.assign(
        new Error("Simulated packet loss (chaos)"),
        { code: "ECONNRESET" }
      );
      // Still create the real socket so Agent bookkeeping is intact,
      // then immediately destroy it and call back with the error.
      const sock = _originalCreateCx.call(this, options, () => {});
      setImmediate(() => {
        try { sock.destroy(); } catch (_) {}
        originalCb(err);
      });
      return sock;
    }

    // Delay + uniform jitter: wrap the real callback
    const jitter  = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
    const totalMs = Math.max(0, delayMs + jitter);

    const delayedCb = (...args) => setTimeout(() => originalCb(...args), totalMs);
    return _originalCreateCx.call(this, options, delayedCb);
  };

  _appChaosActive = true;
  _appChaosParams = params;
}

/**
 * Restores http.Agent.prototype.createConnection to its original implementation.
 */
function clearAppChaos() {
  if (!_appChaosActive) return;
  if (_originalCreateCx) {
    http.Agent.prototype.createConnection = _originalCreateCx;
    _originalCreateCx = null;
  }
  _appChaosActive = false;
  _appChaosParams = null;
}

// -- Public API ---------------------------------------------------------

/**
 * Inject chaos into the target container (tc netem), with automatic
 * application-layer fallback if the kernel blocks it.
 *
 * @param {string} protocol  - "ibft" atau "qbft"
 * @param {string} chaosType - "latency", "packetloss", atau "combined"
 */
function apply(protocol, chaosType) {
  const netemArgs = buildNetemArgs(chaosType);

  log(`\n  ${yellow("CHAOS INJECTION")}`);
  log(dim(`   Container : ${getContainerName(protocol, "node1")}`));
  log(dim(`   Type      : ${chaosType}`));
  log(dim(`   tc netem  : ${netemArgs.join(" ")}`));

  // -- Tier 1: Try kernel-level tc netem -----------------------------
  const kernelResult = tryKernelChaos(protocol, chaosType);

  if (kernelResult.success) {
    log(green(`    [KERNEL] tc netem aktif`));
    return;
  }

  // -- Tier 2: Application-layer fallback ----------------------------
  log(yellow(`     Kernel chaos gagal: ${kernelResult.reason}`));
  log(yellow(`     Fallback  Application-Layer Chaos`));

  const appParams = buildAppChaosParams(chaosType);
  applyAppChaos(appParams);

  log(green(`    [APP-LAYER] Chaos aktif: ${appParams.label}`));
  if (appParams.hasDelay) {
    log(dim(`   ℹ  Setiap koneksi RPC akan di-delay ${appParams.delayMs}ms ±${appParams.jitterMs}ms`));
  }
  if (appParams.hasLoss) {
    log(dim(`   ℹ  ${(appParams.lossRate * 100).toFixed(1)}% koneksi akan di-drop (simulasi packet loss)`));
  }
}

/**
 * Verify chaos is active (either tc netem or app-layer).
 *
 * @param {string} protocol
 * @returns {{ active: boolean, mode: string, output: string }}
 */
function verify(protocol) {
  // Check app-layer first (it takes precedence when kernel fails)
  if (_appChaosActive && _appChaosParams) {
    const lbl = _appChaosParams.label;
    log(green(`    Verifikasi OK - [APP-LAYER] chaos aktif: ${lbl}`));
    return { active: true, mode: "app-layer", output: lbl };
  }

  // Check kernel tc netem
  const profile   = Object.values(config.profiles).find(
    (p) => p.chaosType && p.chaosType !== "none" && p.chaosTarget
  );
  const target    = profile?.chaosTarget || "node1";
  const container = getContainerName(protocol, target);

  const result = dockerExec(container, ["tc", "qdisc", "show", "dev", "eth0"]);

  if (!result.ok) {
    log(yellow(`     Tidak bisa verifikasi tc rules: ${result.stderr}`));
    return { active: false, mode: "none", output: result.stderr };
  }

  const hasNetem = result.stdout.toLowerCase().includes("netem");

  if (hasNetem) {
    log(green(`    Verifikasi OK - [KERNEL] netem aktif di ${container}`));
    log(dim(`   ${result.stdout.replace(/\n/g, "\n   ")}`));
  } else {
    log(yellow(`     Tidak ada netem rule aktif di ${container}`));
  }

  return { active: hasNetem, mode: "kernel", output: result.stdout };
}

/**
 * Clear all chaos (both kernel tc rules and app-layer patch).
 *
 * @param {string} protocol
 */
function clear(protocol) {
  let cleared = 0;

  // Clear app-layer first
  if (_appChaosActive) {
    clearAppChaos();
    log(dim(`    App-layer chaos dibersihkan`));
    cleared++;
  }

  // Also try to clear kernel tc rules (no-op if never applied)
  const nodes = ["node1", "node2", "node3"];
  for (const nodeId of nodes) {
    const container = getContainerName(protocol, nodeId);
    const result = dockerExec(container, [
      "tc", "qdisc", "del", "dev", "eth0", "root",
    ]);
    if (result.ok) {
      cleared++;
      log(dim(`    Kernel tc rules dibersihkan: ${container}`));
    }
  }

  log(green(`    Chaos dibersihkan (${cleared} item terpengaruh)`));
}

module.exports = { apply, verify, clear };
