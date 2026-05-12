# Buku Panduan Skripsi: Komparasi IBFT 2.0 & QBFT

Dokumen ini berisi penjelasan mendetail mengenai setiap baris kode di dalam proyek skripsi ini. Tujuannya adalah sebagai bahan belajar dan referensi agar Anda dapat menjelaskan sistem dengan fasih saat sidang skripsi.

## Fase 1: Smart Contract (`contracts/BansosToken.sol`)

File ini bertindak sebagai "Buku Besar" (Ledger) dari sistem bantuan sosial. Tugasnya adalah mencetak token bansos, mencatat penerima yang sah (whitelist), dan mengatur perpindahan saldo.

**Mengapa ditulis tanpa pustaka OpenZeppelin?**
Untuk mencapai efisiensi ekstrem. Karena pengujian dilakukan pada *edge node* (Intel Core i3, RAM 8GB), smart contract dibuat seminimal mungkin agar proses eksekusi (gas fee & beban CPU) sangat ringan. Ini mencegah smart contract menjadi *bottleneck* saat pengujian performa jaringan.

### 1. Identitas Token & Pengaturan Awal
```solidity
1: // SPDX-License-Identifier: MIT
2: pragma solidity ^0.8.20;
3: 
4: contract BansosToken {
5:     string public name = "Bansos Digital";
6:     string public symbol = "BANSOS";
7:     uint8 public constant decimals = 0;
8:     uint256 private _totalSupply;
```
* **Baris 1-2:** Menandakan lisensi kode (MIT) dan versi bahasa Solidity yang digunakan (0.8.20).
* **Baris 4-6:** Mendeklarasikan nama dan simbol token yang merepresentasikan bantuan sosial di sistem ini.
* **Baris 7 (`decimals = 0`):** **Krusial untuk performa!** Berbeda dengan koin kripto biasa yang memakai 18 desimal, kita memotong komputasi berat dengan menggunakan bilangan bulat utuh. 1 token = 1 keluarga penerima bansos.
* **Baris 8:** Menyimpan catatan total seluruh token bansos yang telah dicetak.

### 2. Ruang Penyimpanan Data (Storage)
```solidity
10:     mapping(address => uint256) private _balances;
11:     mapping(address => mapping(address => uint256)) private _allowances;
12:     mapping(address => bool) public whitelist;
13:     address public admin;
```
* **Baris 10 (`_balances`):** Memetakan alamat dompet ke jumlah saldonya. Ibarat buku tabungan warga.
* **Baris 11 (`_allowances`):** Fitur standar ERC-20 yang mengizinkan pihak lain memakai saldo atas nama pemilik (seperti auto-debit).
* **Baris 12 (`whitelist`):** Keamanan utama sistem. Memetakan alamat dompet ke status `true/false`. Jika `true`, ia berhak menerima bansos.
* **Baris 13 (`admin`):** Alamat pemerintah/kementerian pembuat token.

### 3. Pengeras Suara (Events) & Hak Akses
```solidity
15:     event Transfer(address indexed from, address indexed to, uint256 value);
...
19:     modifier onlyAdmin() {
20:         require(msg.sender == admin, "Hanya admin");
21:         _;
22:     }
...
24:     constructor() {
25:         admin = msg.sender;
26:     }
```
* **Baris 15 (`event`):** Ini penting untuk observabilitas skripsi Anda. Tiap transaksi berhasil, kontrak "meneriakkan" event ini. Nanti, script pemantauan (monitor.js) akan mendengarkan event ini secara *real-time* untuk menghitung metrik TPS tanpa membebani node.
* **Baris 19-22 (`modifier`):** "Satpam" penjaga pintu. Fungsi dengan ini wajib dipanggil oleh admin, jika tidak akan ditolak.
* **Baris 24-26 (`constructor`):** Dijalankan sekali seumur hidup saat rilis. Menetapkan sang pembuat kontrak otomatis sebagai `admin`.

### 4. Fitur Transfer Terproteksi & Keamanan
```solidity
36:     function transfer(address to, uint256 amount) public returns (bool) {
37:         require(whitelist[to], "Penerima tidak terdaftar di whitelist");
38:         _transfer(msg.sender, to, amount);
39:         return true;
40:     }
...
72:     function _transfer(address from, address to, uint256 amount) internal {
73:         require(from != address(0), "Transfer dari alamat nol");
74:         require(to != address(0), "Transfer ke alamat nol");
75:         require(_balances[from] >= amount, "Saldo tidak cukup");
76:         _balances[from] -= amount;
77:         _balances[to] += amount;
78:         emit Transfer(from, to, amount);
79:     }
```
* **Baris 37:** Logika penolakan transfer otomatis jika si target belum masuk database orang miskin yang sah (whitelist).
* **Baris 72-79 (`_transfer`):** Inti mesin perpindahan uang. Dibuat bertipe `internal` (dipakai khusus oleh fungsi lain dalam kontrak ini) agar tidak ada pengulangan kode di fungsi `transferFrom`. Memangkas duplikasi kode memperkecil ukuran file kompilasi, mempercepat eksekusi.

### 5. Pencetakan Uang (Minting) & Whitelisting
```solidity
60:     function mint(address to, uint256 amount) public onlyAdmin {
61:         require(whitelist[to], "Penerima tidak terdaftar di whitelist");
62:         _totalSupply += amount;
63:         _balances[to] += amount;
64:         emit Transfer(address(0), to, amount);
65:     }
66: 
67:     function setWhitelist(address account, bool status) public onlyAdmin {
68:         whitelist[account] = status;
69:         emit WhitelistUpdated(account, status);
70:     }
```
* **Baris 60-65:** Hanya admin yang bisa mencetak saldo baru ke dompet target. Tentu dompet target harus masuk whitelist dulu.
* **Baris 67-70:** Fungsi bagi admin untuk mendaftarkan alamat warga agar status whitelist-nya menjadi `true`.


---

## Fase 2: Jaringan & Infrastruktur

Fase ini mendefinisikan aturan main blockchain (Konsensus) dan wadah eksekusinya (Docker Container).

### 1. `ibft2/genesis.json` (DNA Jaringan)
File ini adalah cetak biru blok pertama (Block 0) di jaringan. Ibarat konstitusi negara.
```json
9:     "ibft2": {
10:       "blockperiodseconds": 2,
11:       "epochlength": 30000,
12:       "requesttimeoutseconds": 4
13:     }
```
* **Baris 10 (`blockperiodseconds = 2`):** Aturan waktu: node wajib mencetak blok baru setiap 2 detik. Ini parameter konsensus yang diuji dalam skripsi Anda.
* **Baris 12 (`requesttimeoutseconds = 4`):** Toleransi waktu. Rasio 2:1 antara timeout (4) dan block period (2) penting untuk menghindari node menyerah terlalu cepat (*round change* prematur) saat jaringan sibuk di-stress test.

### 2. `ibft2/docker-compose.yml` (Batas Fisik & Eksekusi)
Mengatur limitasi RAM dan CPU untuk mereplikasi environment Edge Node.
```yaml
7:     cpus: "1.0"
8:     mem_limit: 2500M
...
18:       - BESU_OPTS=-Xmx2g -Xms1g
...
35:       - --rpc-http-max-active-connections=2000
37:       - --tx-pool-layer-max-capacity=25000
```
* **Baris 8 (`mem_limit`):** Membatasi container maksimal memakai 2.5 GB RAM. Karena ada 3 node, total 7.5 GB, pas untuk laptop RAM 8 GB.
* **Baris 18 (`BESU_OPTS`):** Batasan JVM (Java Virtual Machine). `-Xmx2g` berarti batas atas memori Java adalah 2 GB (menyisakan 500MB untuk kernel Linux). Jika ini tidak diset, Besu akan memakan habis RAM laptop Anda (OOM Killer).
* **Baris 35 & 37:** Diperbesar untuk menampung *flood* transaksi saat benchmark. Koneksi maksimum RPC diatur ke 2000 agar koneksi Node.js tidak ditolak (`ECONNREFUSED`).

---

## Fase 3: Setup & Orkestrasi

Ini adalah skrip otomatisasi. Ibarat asisten laboratorium yang menyiapkan alat sebelum eksperimen dimulai.

### 1. `scripts/menu.js` (CLI Interaktif)
Ini adalah antarmuka utama proyek Anda.
```javascript
195: function tcpPing(host, port, timeoutMs) {
196:   return new Promise((resolve) => {
197:     const socket = new net.Socket();
...
383:     const rpcReady = await waitForRpc(proto);
```
* **Analogi:** Seperti mengetuk pintu (*tcpPing*) sebelum masuk kamar.
* **Konteks:** Node.js berjalan jauh lebih cepat daripada inisialisasi node Java (Besu). Jika skrip benchmark langsung jalan sebelum port 8545 siap, skrip akan *crash*. `tcpPing` menggunakan `net.Socket` (layer TCP) untuk mengetuk port dengan beban 0% ke CPU. Baru setelah port terbuka, skrip benchmark diluncurkan.

### 2. `scripts/automation/setup.js` (Ethers.js & Funding)
Skrip penyuntikan dana awal ke akun *sender* untuk membayar gas fee.
```javascript
44:       const bn = await provider.getBlockNumber();
...
129:     const tx = await contract.mint(sender.address, config.tokenPerSender, {
130:       nonce: nonce++,
131:       gasLimit: 100_000,
132:     });
```
* **Baris 44 (`getBlockNumber`):** *Health Check* kedua. Walau port TCP terbuka, blockchain mungkin belum sinkron. Fungsi ini memastikan node benar-benar siap menerima transaksi.
* **Baris 130 (`nonce++`):** *Nonce* adalah nomor antrean transaksi. Karena kita menembak banyak transaksi secara sekuensial cepat, kita tidak bisa menunggu transaksi sebelumnya selesai. Kita hitung manual (`nonce++`) agar semua transaksi bisa dilempar ke *mempool* sekaligus!

---

## Fase 4: Inti Benchmark (Paling Krusial)

Ini adalah jantung skripsi Anda. Di sini kita menembakkan ribuan transaksi dan mengukur kinerjanya.

### 1. `scripts/core/benchmark.js` (Worker Stress-Test)
```javascript
39:   fetchReq.agent = new http.Agent({ keepAlive: true, maxSockets: 250 });
...
68:   for (let i = 0; i < totalTx; i++) {
...
84:     const signed = await Promise.all(batch.map(({ wIdx, tx }) => wallets[wIdx].signTransaction(tx)));
85:     payloads.push(...signed);
```
* **Baris 39 (`http.Agent`):** Penggunaan ulang koneksi (Connection Pooling). Alih-alih membuka koneksi TCP baru setiap kali transaksi dikirim (yang sangat lambat dan memakan CPU), kita menjaga pipa tetap terbuka (`keepAlive: true`).
* **Baris 84 (`signTransaction`):** **RAHASIA OPTIMASI!** Menandatangani (*signing*) transaksi dengan kunci privat (*private key*) butuh komputasi kriptografi berat. Jika kita menandatangani saat *timer* berjalan (fase *Measurement*), hasil TPS akan menurun karena CPU laptop Anda sibuk menghitung kriptografi, bukan jaringan blockchain-nya! Jadi, kita tanda tangani semua transaksi *sebelum* timer mulai (Pre-signing) dan simpan dalam RAM (array `payloads`).

### 2. `scripts/core/orchestrator.js` (Manajer Pengujian)
```javascript
43: function tryGC() {
44:   if (typeof global.gc === "function") {
45:     global.gc();
46:   }
...
183:       const resultStream = fs.createWriteStream(csvPath, { flags: "a" });
184:       resultStream.write(CSV_HEADER);
```
* **Baris 44 (`global.gc()`):** Pemanggilan Garbage Collection (Penyapu Memori) secara manual. *HANYA* dilakukan di fase *Cooldown* (istirahat antar TPS). Jika dibiarkan otomatis, Node.js bisa tiba-tiba menyapu memori di tengah pengujian TPS tinggi, menyebabkan jeda palsu (latency artifisial).
* **Baris 183 (`fs.createWriteStream`):** Penulisan laporan ke CSV menggunakan metode *Non-Blocking Stream*. Tidak menggunakan `writeFileSync` karena itu akan menghentikan seluruh program saat menyimpan file.

---

## Fase 5: Observabilitas & Analisis

Fase ini bertugas menjadi saksi mata (mengumpulkan data memori dan error) dan hakim (analisis statistik hasil).

### 1. `scripts/utils/monitor.js` & `roundchange.js` (Pemantau Nol-Beban)
```javascript
67:   dockerProcess = spawn(
68:     "docker",
69:     ["stats", "--format", "{{.Name}},{{.CPUPerc}},{{.MemUsage}}"],
```
* **Baris 67 (`spawn docker stats`):** Skrip ini menggunakan satu proses `docker stats` yang mengalir terus (*continuous stream*). Tidak ada *looping* pemanggilan secara berulang karena memanggil *subprocess* secara berulang memakan banyak memori dan CPU. Data dialirkan langsung ke file CSV (Zero-Overhead).
* Hal serupa terjadi di `roundchange.js` yang menyadap `docker logs` tanpa henti untuk mencari tanda-tanda konsensus terputus (*round change*).

### 2. `scripts/automation/analyze.js` (Uji Hipotesis Skripsi)
Karena ini karya ilmiah (skripsi), kita tidak bisa hanya bilang "IBFT lebih cepat dari QBFT". Kita butuh bukti secara statistik.
```javascript
79: function mannWhitneyU(sample1, sample2) { ... }
...
118:   const significant = p < 0.05;
```
* **`mannWhitneyU`:** Karena sebaran data latensi blockchain biasanya tidak beraturan (non-parametrik), kita tidak bisa memakai Uji-T biasa. Uji Mann-Whitney U membandingkan peringkat (*rank*) latensi IBFT dan QBFT.
* **Baris 118 (`p < 0.05`):** Skrip ini secara otomatis menghitung *p-value* (Nilai Kemungkinan). Jika `p < 0.05`, itu berarti secara statistik performa konsensus IBFT dan QBFT benar-benar berbeda nyata (bukan kebetulan). Ini adalah kesimpulan mutlak untuk Bab 4 dan Bab 5 di Skripsi Anda!
