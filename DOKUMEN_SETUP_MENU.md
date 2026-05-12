# Bedah Kode Lengkap: Setup & Orkestrasi Menu

Dokumen ini membedah skrip yang bertugas mengatur alur program dari awal (menu antarmuka) hingga ke pendanaan dompet untuk pengujian (`setup.js`).

## 1. `scripts/menu.js` (Sang Pusat Komando)

File ini adalah antarmuka CLI (Command Line Interface) yang tampil saat Anda pertama kali menyalakan proyek. Ia bukan sekadar menu teks biasa, melainkan pengatur lalu lintas (*Traffic Controller*) Docker.

### A. Registrasi Port dan Konstanta
```javascript
31: // Harus sinkron dengan config.networks[protocol].rpcUrl
32: const RPC_PORTS = {
33:   ibft: 8545,
34:   qbft: 18545,
35: };
...
38: const RPC_PING_TIMEOUT = 3000; // ms per percobaan TCP connect
```
- **Baris 32-35:** Kita mendaftarkan *port* untuk masing-masing konsensus. IBFT di 8545, QBFT di 18545. 
- **Baris 38:** Menentukan batas waktu 3 detik maksimal untuk setiap kali mencoba mengetuk pintu server (*ping*).

### B. Fungsi Detak Jantung Jaringan (*TCP Health-Check Ping*)
```javascript
195: function tcpPing(host, port, timeoutMs) {
196:   return new Promise((resolve) => {
197:     const socket = new net.Socket();
198:     let settled = false;
...
209:     socket.setTimeout(timeoutMs);
210:     socket.on("connect", () => done(true));
211:     socket.on("timeout", () => done(false));
212:     socket.on("error", () => done(false));
213: 
214:     socket.connect(port, host);
215:   });
216: }
```
- **Penjelasan Krusial:** Jika Anda menembak jaringan blockchain sebelum ia benar-benar "bangun", Node.js Anda akan *crash* dengan error `ECONNREFUSED`. Skrip ini melakukan pengecekan dengan modul `net.Socket`. Modul ini sangat ringan karena ia hanya melakukan jabat tangan TCP (*TCP Handshake*). Berbeda dengan ping HTTP (seperti Axios) yang butuh transfer *body* data besar, ping TCP murni hanya memeriksa "Apakah gerbangnya sudah terbuka?". Jika ya, kembalikan `true` (Baris 210).

### C. Eksekutor Proses Anak (*Child Process Spawner*)
```javascript
358:   // -- Step 1: docker-compose up -d ------------------------------------
...
368:       execSync("docker-compose up -d", { cwd: dirPath, stdio: "inherit" });
...
398:   activeChildProcess = spawn(selected.cmd, selected.args, {
399:     stdio: "inherit",
400:     shell: false,
401:   });
```
- **Baris 368:** `execSync` memanggil Docker secara tersinkronisasi. Ia menyalakan mesin kontainer secara otomatis ("Zero-Touch Provisioning"). Anda tidak perlu mengetik perintah Docker manual.
- **Baris 398:** Setelah Docker siap (dan TCP Ping sukses), Node.js tidak memanggil skrip lain secara langsung, melainkan melahirkan "anak proses" baru (`spawn`). Alasannya? Agar jika skrip tes *crash*, menu utama ini tidak ikut *crash*. Ia bisa menangkap kode *error*-nya dan menampilkan menu kembali.

---

## 2. `scripts/automation/setup.js` (Sang Bendahara)

File ini dijalankan sebelum benchmark dimulai. Tugas utamanya adalah *Deploy* Smart Contract, mendaftarkan *Whitelist*, dan menyuntikkan dana ETH ke akun bot (*Funding*).

### A. Proteksi Provider (Node Readiness)
```javascript
40: async function waitForProvider(provider, maxRetries = 30, intervalMs = 2000) {
41:   log(`  \x1b[90m Menunggu node RPC siap...\x1b[0m`);
42:   for (let i = 1; i <= maxRetries; i++) {
43:     try {
44:       const bn = await provider.getBlockNumber();
45:       log(`  \x1b[32m Node siap - Block #${bn}\x1b[0m`);
46:       return true;
47:     } catch { ... }
```
- Walaupun TCP Ping di `menu.js` berhasil, blockchain Java (Besu) kadang butuh waktu beberapa detik tambahan untuk menyelaraskan internal bloknya (sinkronisasi rantai). Fungsi ini menggunakan metode `getBlockNumber()` Ethers.js. Ini seperti bertanya, "Apakah Anda sudah bisa membaca blok?". Jika ia berhasil membaca, barulah proses *deploy* dimulai.

### B. Deploy dan Penyimpanan Alamat Kontrak
```javascript
95:   const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
96: 
97:   const contractDeploy = await factory.deploy();
98:   await contractDeploy.waitForDeployment();
99:   const contractAddress = await contractDeploy.getAddress();
...
110:   fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));
```
- **Baris 95-99:** Standar deployment *smart contract* Ethers v6. Kita menggunakan kunci privat Admin (`wallet`) untuk menanamkan kode ke jaringan.
- **Baris 110:** Menyimpan alamat kontrak yang baru di-*deploy* ke file JSON agar nanti `benchmark.js` tahu ke alamat mana ia harus menembak transaksinya.

### C. Looping Funding dengan Manajemen Nonce
```javascript
123:     if (!(await contract.whitelist(sender.address))) {
124:       await contract.setWhitelist(sender.address, true, {
125:         nonce: nonce++,
126:         gasLimit: 100_000,
127:       });
128:     }
129:     const tx = await contract.mint(sender.address, config.tokenPerSender, {
130:       nonce: nonce++,
131:       gasLimit: 100_000,
132:     });
```
- Karena ada puluhan/ratusan dompet bot, kita tidak menunggunya satu-satu. Kita membaca nilai antrean terkini (`await wallet.getNonce()`) di awal, lalu menambahkannya secara manual di RAM (`nonce: nonce++`). Dengan ini, ratusan transaksi *Whitelist* dan *Mint* (cetak token) dilempar ke *mempool* nyaris di detik yang sama, membuat proses *Setup* yang biasanya butuh bermenit-menit menjadi hanya beberapa detik saja.
