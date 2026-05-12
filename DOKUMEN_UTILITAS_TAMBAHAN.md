# Bedah Kode Lengkap: Utilitas Tambahan & Pembersihan

Dokumen ini membedah tiga skrip pelengkap yang sangat krusial untuk menjaga stabilitas infrastruktur (pembersihan memori) dan simulasi gangguan (*Chaos Testing*). Ini adalah kartu as Anda jika dosen penguji bertanya tentang teknis lingkungan pengujian.

---

## 1. `scripts/automation/reset_network.js` (Sang Petugas Kebersihan)

Dalam penelitian *benchmark*, jika sisa transaksi sebelumnya tidak dihapus, *database* node akan membengkak, memakan RAM, dan merusak akurasi pengujian berikutnya. Skrip ini bertugas mereset semuanya ke Titik Nol.

### A. Pembantaian Kontainer Docker secara Paksa
```javascript
18:   log(`\n\x1b[45m\x1b[37m  RESET NETWORK: ${protocol.toUpperCase()} \x1b[0m`);
19:   const composeDir = protocol === "ibft" ? "ibft2" : "qbft";
20:   const dirPath = path.join(__dirname, "..", "..", composeDir);
21: 
22:   log("   Menghentikan & menghapus container (docker-compose down)...");
23:   try {
24:     execSync("docker-compose down -v --remove-orphans", { cwd: dirPath, stdio: "ignore" });
25:   } catch (err) {
26:     log(`  \x1b[33m  Peringatan docker-compose down: ${err.message}\x1b[0m`);
27:   }
```
*   **Baris 24:** Ini adalah eksekusi baris perintah (`execSync`) langsung ke Docker. Perintah `down -v --remove-orphans` tidak hanya mematikan kontainer, tetapi juga menghancurkan wadah penyimpanan *volume* sementara dan jaringan virtualnya (besu_net). Ini memastikan tidak ada "hantu" koneksi soket lama (EADDRINUSE) yang tertinggal.

### B. Penghapusan Hard Disk (Database Node)
```javascript
35:   const dataDirs = [
36:     path.join(dirPath, "node1", "data"),
37:     path.join(dirPath, "node2", "data"),
38:     path.join(dirPath, "node3", "data"),
39:   ];
40: 
41:   let deletedCount = 0;
42:   for (const dataDir of dataDirs) {
43:     if (fs.existsSync(dataDir)) {
44:       // Hapus rekursif seluruh isi folder data/
45:       fs.rmSync(dataDir, { recursive: true, force: true });
46:       fs.mkdirSync(dataDir, { recursive: true });
47:       deletedCount++;
48:     }
49:   }
```
*   **Baris 45-46 (`fs.rmSync` dan `fs.mkdirSync`):** Docker memetakan folder penyimpanan *database* blok ke folder laptop Anda (`node1/data`, dst). Skrip ini secara paksa (`force: true`) menghapus direktori beserta isinya (rekursif) secara permanen. Lalu ia segera membuat folder kosong dengan nama yang sama. Mengapa? Karena saat Docker nanti dinyalakan ulang, ia akan membaca direktori kosong tersebut dan merasa bahwa ini adalah hari pertamanya bekerja (kembali ke *Genesis* awal).

---

## 2. `scripts/utils/chaos.js` (Sang Perusak Jaringan)

Untuk skenario *Chaos Latency* (skenario di mana internet warga buruk) dan *Packet Loss* (sinyal putus-putus), skrip ini menyuntikkan penyakit langsung ke urat nadi kontainer.

### A. Eksekusi `tc qdisc` (Traffic Control) Linux
```javascript
49: function applyChaosToContainer(container, rules) {
...
54:   // Bersihkan rule lama dulu (jika ada) untuk mencegah penumpukan
55:   try {
56:     execSync(`docker exec ${container} tc qdisc del dev eth0 root`, { stdio: "ignore" });
57:   } catch (_) {} // Abaikan jika memang belum ada rule
58: 
59:   // Contoh command: docker exec besu-node1 tc qdisc add dev eth0 root netem delay 200ms
60:   const cmd = `docker exec ${container} tc qdisc add dev eth0 root netem ${rules}`;
61:   execSync(cmd, { stdio: "ignore" });
62: }
```
*   **Baris 56 (`del dev eth0 root`):** Sebelum memberi "penyakit" baru, ia menyembuhkan penyakit lama agar tidak terjadi penumpukan (misalnya, tes latensi 200ms tertumpuk dengan packet loss 1% menjadi *Chaos Combined* yang tak terkontrol).
*   **Baris 60 (`netem delay 200ms`):** Perhatikan kata `netem` (*Network Emulator*). Ini adalah utilitas murni bawaan inti sistem operasi Linux (kernel). Dengan menjalankan ini ke `eth0` (kartu jaringan kontainer Docker), kita menyuruh Linux untuk menahan setiap paket internet selama 200 milidetik secara sengaja. Ini simulasi gangguan *Edge* yang sangat akurat secara teknis, bukan sekadar jeda `sleep` buatan di Node.js!

---

## 3. `scripts/utils/config.js` (Pusat Kendali Global)

Satu file untuk mengatur semuanya. Jika Anda ingin mengubah durasi *stopwatch* tes dari 60 detik menjadi 120 detik, Anda tidak perlu mencari-cari di kode yang panjang, cukup di sini.

```javascript
39:   benchmark: {
40:     warmup: 10,                 // detik
41:     duration: 60,               // detik measurement (pengukuran)
42:     drainTimeout: 60000,        // maksimal tunggu konfirmasi sisa tx (ms)
43:     cooldownBetweenTps: 30000,  // istirahat antar TPS target (ms) -> mempool drain
44:     cooldownBetweenRuns: 60000, // istirahat penuh antar repetisi (ms)
...
49:   },
```
*   **Baris 40-41 (`warmup` & `duration`):** Anda melakukan pemanasan 10 detik agar CPU stabil (seperti mobil memanaskan mesin), lalu mengukur metrik asli selama 60 detik.
*   **Baris 43 (`cooldownBetweenTps = 30000`):** 30.000 milidetik (30 detik). Inilah waktu di mana fungsi `tryGC()` (pembersihan sampah memori) dipanggil oleh *Orchestrator*, memungkinkan mempool Docker yang tadinya dibombardir ribuan transaksi dapat bernapas lega sebelum tes kecepatan selanjutnya dimulai.
