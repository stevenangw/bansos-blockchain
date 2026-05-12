# Bedah Kode Lengkap: Inti Benchmark

Dokumen ini membedah baris demi baris secara komprehensif dari skrip `benchmark.js` dan `orchestrator.js`, yang merupakan tulang punggung (inti) dari pengujian skripsi Anda.

---

## 1. `scripts/core/benchmark.js` (Sang Pekerja / *Worker*)

File ini bertanggung jawab untuk mempersiapkan ribuan transaksi, mengirimkannya ke node dengan kecepatan (TPS) tertentu, dan mencatat waktu yang dibutuhkan hingga transaksi tersebut dikonfirmasi (Latensi).

### A. Persiapan dan *Pooling* Koneksi
```javascript
7: const { ethers } = require("ethers");
...
38:   const fetchReq = new ethers.FetchRequest(net.rpcUrl);
39:   fetchReq.agent = new http.Agent({ keepAlive: true, maxSockets: 250 });
40:   const provider = new ethers.JsonRpcProvider(fetchReq, undefined, { staticNetwork: true, batchMaxCount: 1 });
41:   provider.on("error", () => {});
```
*   **Baris 7-10:** Mengimpor alat yang dibutuhkan: `ethers` (interaksi blockchain), `http` (jaringan), dan `config` (pengaturan dari `config.js`).
*   **Baris 38-40 (Krusial):** Ini adalah optimasi tingkat tinggi. Daripada membuka koneksi TCP baru untuk setiap transaksi (yang sangat membebani CPU), kita membuat `http.Agent` dengan `keepAlive: true` dan `maxSockets: 250`. Ini seperti membiarkan 250 pintu gerbang tetap terbuka terus agar transaksi bisa lewat tanpa antre buka pintu. Pengaturan `staticNetwork: true` melarang Ethers.js mengecek ID Jaringan berkali-kali (menghemat I/O).
*   **Baris 41:** Jika node terputus sebentar, Ethers suka mencetak error berisik. Kita matikan log error *background* ini agar terminal Anda bersih saat sidang/demo.

### B. Pra-Tanda Tangan (*Pre-Signing* ke RAM)
```javascript
63:   const totalTx = tpsTarget * (warmup + duration + 5);
...
68:   for (let i = 0; i < totalTx; i++) {
69:     const wIdx = i % wallets.length;
70:     descriptors.push({
...
74:         nonce: nonces[wIdx]++,
75:         gasLimit: gasLimit.transfer,
...
82:   const payloads = [];
83:   for (const batch of chunkArray(descriptors, Math.max(wallets.length, 10))) {
84:     const signed = await Promise.all(batch.map(({ wIdx, tx }) => wallets[wIdx].signTransaction(tx)));
85:     payloads.push(...signed);
86:   }
```
*   **Baris 63:** Menghitung *total* semua transaksi yang dibutuhkan selama pengujian (waktu pemanasan + waktu ukur utama + cadangan drain). Misalnya, 100 TPS selama 60 detik = 6000 transaksi.
*   **Baris 68-74:** Kita menyusun rancangan transaksi di awal. Perhatikan `nonce: nonces[wIdx]++`. Kita memanipulasi nomor antrean transaksi secara manual agar bisa menembak beruntun tanpa menabrak satu sama lain.
*   **Baris 82-86 (Sangat Krusial):** **Ini adalah argumen pembelaan skripsi Anda.** Menandatangani transaksi dengan kriptografi (*private key*) memakan 100% kinerja CPU. Jika kita menembak sambil menandatangani, hasil latensi Anda akan jelek karena CPU komputer yang melambat, *bukan* blockchainnya. Oleh karena itu, kita menandatangani 6000 transaksi itu *di awal* (Pre-signing), mengubahnya menjadi *string hex* mentah (payloads), lalu menyimpannya di RAM komputer Anda (array `payloads`). 

### C. Mekanisme Tembak Tahan Banting (*Retry Loop*)
```javascript
95:   const sendWithRetry = async (rawTx) => {
96:     let lastErr;
97:     for (let i = 1; i <= 3; i++) {
98:       try {
99:         return await provider.broadcastTransaction(rawTx);
100:       } catch (err) {
101:         lastErr = err;
102:         const msg = (err.message || "").toLowerCase();
103:         if (msg.includes("known") || msg.includes("nonce too low") || msg.includes("already used")) {
104:           return { wait: async () => ({ status: 1, hash: "already_known" }) };
105:         }
...
107:         await sleep(100 * i);
108:       }
109:     }
110:     throw lastErr;
111:   };
```
*   **Baris 95-111:** Jaringan *edge node* gampang *ngos-ngosan*. Saat kita kirim 500 transaksi per detik, node mungkin menolak koneksi sebentar (*timeout*). Fungsi ini memaksa skrip untuk mencoba ulang 3 kali (`for i=1..3`) sebelum menyerah.
*   **Baris 103-104:** Mengatasi masalah "Mempool Penuh". Jika node menolak karena *nonce* sama (berarti transaksi sebenarnya sudah berhasil masuk di percobaan sebelumnya), skrip akan memakluminya dan menganggapnya sukses (`already_known`).

### D. Eksekusi Pengujian (*Phases*)
```javascript
157:   log(c.dim(`  * Phase: Measurement (${duration}s)...`));
158:   const measureStart = Date.now();
159:   const measureEnd = measureStart + duration * 1000;
160: 
161:   while (Date.now() < measureEnd) {
162:     const tick = Date.now();
163:     await broadcastBatch(tpsTarget, true);
164:     const elapsed = Date.now() - tick;
165:     if (elapsed < 1000) await sleep(1000 - elapsed);
166:   }
```
*   **Baris 157-166:** Ini adalah jantung *stopwatch*-nya.
*   Logikanya: Catat waktu (`tick`), tembak 100 transaksi (`broadcastBatch`), lalu lihat berapa lama waktu yang dihabiskan (`elapsed`). Jika kita menghabiskan waktu 200 ms untuk menembak, skrip akan tidur selama 800 ms (`await sleep(1000 - elapsed)`). Ini memastikan kita secara presisi mengirim tepat per detik tanpa melenceng (melakukan *pacing* akurat).

### E. Perhitungan Metrik Statistik
```javascript
183:   const okResults = results.filter((r) => r.ok);
184:   const txOk = okResults.length;
185:   const txFail = results.length - txOk;
186:   const latencies = okResults.map((r) => r.confirmTime - r.sendTime).sort((a, b) => a - b);
187:   
188:   const throughput = actualDuration > 0 ? parseFloat((txOk / actualDuration).toFixed(2)) : 0;
...
191:   const latencyP95 = percentile(latencies, 95);
```
*   **Baris 183-186:** Memisahkan yang sukses dan gagal. Waktu konfirmasi dikurangi waktu tembak (`confirmTime - sendTime`) adalah *Latensi*.
*   **Baris 188:** Menghitung TPS sesungguhnya (*Throughput*): Jumlah transaksi valid dibagi durasi detik yang sesungguhnya terjadi.
*   **Baris 191:** Mengambil persentil 95 (P95) dari urutan latensi. Angka inilah yang nanti dianalisis statistik.

---

## 2. `scripts/core/orchestrator.js` (Sang Manajer)

Jika `benchmark.js` adalah pekerja, maka `orchestrator.js` adalah Manajer yang mengendalikan urutan tugas, memicu chaos, mencatat CSV, dan mengendalikan *Garbage Collector*.

### A. Kontrol Memori Manual (Garbage Collection)
```javascript
43: function tryGC() {
44:   if (typeof global.gc === "function") {
45:     global.gc();
46:     log("  GC triggered (cooldown phase)");
47:   }
48: }
```
*   **Baris 43-48:** Javascript memiliki *Garbage Collector* otomatis yang menyapu RAM dari sampah variabel tak terpakai. Masalahnya, penyapuan otomatis ini menghabiskan CPU dan bisa terjadi secara acak di tengah-tengah pengujian (menyebabkan lag *spike*). Dengan menjalankan aplikasi via flag `--expose-gc` di Node.js, kita bisa memaksa pembersihan memori.
*   Manajer (`orchestrator.js`) *hanya* akan memanggil ini di saat istirahat (*cooldown phase*). Saat fase *Measurement* berlangsung, GC diam total!

### B. Integrasi Modul Eksternal
```javascript
159:   // -- Resource Monitor (Single Process, Continuous Stream) -----------
160:   const monitorPath = monitor.start(protocol, opts.profileName);
...
163:   // -- Chaos Setup ----------------------------------------------------
164:   if (isChaos) {
...
166:     chaos.apply(protocol, profile.chaosType);
167:     log(" Waiting 5s for chaos to stabilize...");
168:     await sleep(5000);
169:     const rcPath = roundchange.start(protocol, profile.chaosType);
170:   }
```
*   **Baris 159-170:** Sebelum menyuruh sang Pekerja jalan, Manajer menyalakan CCTV jaringan (`monitor.start` untuk merekam CPU/RAM via Docker). 
*   Jika mode *Chaos* aktif (seperti skenario Packet Loss di skripsi), Manajer menggunakan utilitas Linux `tc qdisc` (lewat modul `chaos.js`) untuk mencekik jaringan kontainer Docker. Lalu Manajer menyalakan perekam log khusus (`roundchange.start`) untuk mencari momen di mana sistem mengalami kegagalan konsensus/sinkronisasi.

### C. Aliran Penulisan ke File (Non-Blocking Stream)
```javascript
182:       // Non-blocking CSV write stream
183:       const resultStream = fs.createWriteStream(csvPath, { flags: "a" });
184:       resultStream.write(CSV_HEADER);
...
193:           const result = await runBenchmark(protocol, tps);
194:           const csvLine = rowToCsv(result);
195:           resultStream.write(csvLine + "\n");
```
*   **Baris 183-195:** Kita **tidak** menggunakan `fs.writeFileSync`. Menyimpan file secara sinkronus (*blocking*) akan menahan aliran program (*event loop*). Mengingat sistem harus memantau ratusan ribu koneksi soket, kita membuka `WriteStream` yang bekerja di latar belakang (melalui librari *libuv* C++ milik Node.js) sehingga Node.js tetap lancar meladeni HTTP tanpa terputus. Hasil *benchmark* (objek JSON) dikonversi ke baris CSV (`rowToCsv`) lalu dialirkan (*piped*) ke hard disk secara aman.

### D. Relaksasi Node (*Cooldowns*)
```javascript
202:         // Cooldown between TPS levels - GC setelah benchmark selesai
203:         if (tps !== tpsTargets[tpsTargets.length - 1]) {
204:           const cd = config.benchmark.cooldownBetweenTps / 1000;
205:           log(dim(`   Cooldown ${cd}s...`));
206:           await sleep(config.benchmark.cooldownBetweenTps);
207:           tryGC();
208:         }
```
*   **Baris 202-208:** Setelah menembak 500 TPS selama 60 detik, *mempool* Docker Besu mungkin masih penuh dan antrean blok sedang sibuk memproses sisa transaksi. Manajer memaksa sistem berhenti menembak (*Cooldown*) selama 30 detik (diatur di `config.js`) agar node punya waktu menyelesaikan sisa tugasnya (Drain), lalu disapu memorinya (`tryGC()`). Tanpa fase ini, pengujian TPS selanjutnya (misal dari 500 TPS naik ke 600 TPS) akan langsung gagal/ditolak.
