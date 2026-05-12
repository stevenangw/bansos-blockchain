const { spawn, execSync } = require("child_process");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const isWin = /^win/.test(process.platform);

console.log("=========================================");
console.log(" STARTING SISTEM INFORMASI BANSOS");
console.log("=========================================\n");

// 1. Jalankan Backend
console.log(" Memulai Backend API...");
const backendProcess = spawn("node", ["backend/index.js"], {
  cwd: ROOT_DIR,
  stdio: ["ignore", "inherit", "inherit"],
  shell: false,
});

// 2. Jalankan Frontend
console.log(" Memulai Frontend (Vite)...");
const cmd = isWin ? "cmd.exe" : "npm";
const args = isWin ? ["/c", "npm", "run", "dev", "--prefix", "frontend"] : ["run", "dev", "--prefix", "frontend"];
const frontendProcess = spawn(cmd, args, {
  cwd: ROOT_DIR,
  stdio: ["ignore", "inherit", "inherit"],
  shell: false,
});

// Penanganan graceful exit - force kill process tree di Windows
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n\n Menutup Sistem Informasi...");

  if (isWin) {
    // Di Windows/Git Bash, SIGINT tidak mematikan child tree.
    // Gunakan taskkill /T /F untuk kill seluruh process tree.
    try {
      if (backendProcess.pid) execSync(`taskkill /PID ${backendProcess.pid} /T /F`, { stdio: "ignore" });
    } catch (_) {}
    try {
      if (frontendProcess.pid) execSync(`taskkill /PID ${frontendProcess.pid} /T /F`, { stdio: "ignore" });
    } catch (_) {}
  } else {
    if (!backendProcess.killed) backendProcess.kill("SIGINT");
    if (!frontendProcess.killed) frontendProcess.kill("SIGINT");
  }

  // Pastikan proses induk juga keluar
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Tangkap juga input 'q' untuk quit (seperti Vite)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (key) => {
    if (key.toString() === "q" || key.toString() === "\u0003") {
      // 'q' atau Ctrl+C
      shutdown();
    }
  });
}

backendProcess.on("close", (code) => {
  console.log(`Backend keluar dengan exit code ${code}`);
});

frontendProcess.on("close", (code) => {
  console.log(`Frontend keluar dengan exit code ${code}`);
});

console.log("\n Tekan 'q' atau Ctrl+C untuk menghentikan semua proses.\n");
