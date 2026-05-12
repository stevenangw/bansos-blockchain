# Bedah Kode Lengkap: Monitor & Analisis Statistik

Dokumen ini membedah modul-modul observabilitas (*monitoring*) dan penghitungan statistik untuk membuktikan validitas skripsi Anda.

---

## 1. `scripts/utils/monitor.js` (Kamera CCTV)

Skrip ini mencatat CPU dan RAM Docker tanpa membebani laptop.

### A. Sub-Proses Berjalan Terus (*Continuous Stream*)
```javascript
67:   dockerProcess = spawn(
68:     "docker",
69:     [
70:       "stats",
71:       "--format",
72:       "{{.Name}},{{.CPUPerc}},{{.MemUsage}}",
73:       // Tidak ada --no-stream: proses ini hidup selama benchmark berlangsung
74:     ],
```
- Memanggil proses dari luar (seperti mengetik perintah di terminal) butuh CPU besar jika diulang-ulang. Jadi, alih-alih me-loop pemanggilan `docker stats` setiap 1 detik, skrip memanggil fungsi `spawn` satu kali saja. 
- Karena parameter `--no-stream` tidak ada, Docker akan terus mengirimkan aliran data ke Node.js. Skrip ini hanya pasif mendengarkan dan mengarahkan air (*stream*) tersebut masuk ke file CSV. Efek samping ke CPU nyaris **Nol!**

### B. Pembersihan Karakter Aneh (ANSI Stripping)
```javascript
35: const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
...
84:     const raw = chunk.toString().replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
```
- Sistem operasi Windows sering mencetak karakter warna aneh (seperti `\x1b[31m`) di terminal. Jika langsung disimpan ke CSV, Excel/SPSS tidak akan bisa membacanya. Fungsi *Regex* (Regular Expression) ini bertugas menyedot dan membuang warna-warna aneh tersebut secara *real-time*.

---

## 2. `scripts/utils/roundchange.js` (Pendeteksi Kesalahan Jaringan)

Saat kita memasukkan Chaos (seperti *Packet Loss*), kita ingin tahu apakah algoritma PBFT sanggup bertahan atau ia terpaksa melakukan "*Round Change*" (pemilihan ulang pemimpin blok karena pemimpin sebelumnya gagal).

```javascript
24: const ROUND_CHANGE_PATTERNS = [
25:   "round change",
26:   "ROUND_CHANGE",
...
68:   const proc = spawn("docker", ["logs", "-f", "--since", "1s", container], {
...
75:     for (const pattern of ROUND_CHANGE_PATTERNS) {
76:       if (lineStr.toLowerCase().includes(pattern.toLowerCase())) {
77:         eventCount++;
```
- Daripada membaca file log ratusan Megabyte yang bisa memakan RAM, skrip ini menggunakan `docker logs -f` untuk mencegat setiap baris log baru secara instan (*tailing*).
- Jika ada kata "round change" di log, ia menaikkan hitungan `eventCount++`. Hitungan ini menjadi bukti empiris untuk Bab Analisis Anda!

---

## 3. `scripts/automation/analyze.js` (Sang Ahli Statistik)

File ini akan dibaca oleh Dosen Penguji untuk mengecek apakah Anda mengarang kesimpulan atau tidak. Ini berisi *uji statistik parametrik/non-parametrik*.

### A. Uji Mann-Whitney U (Non-Parametrik)
Karena fluktuasi latensi jaringan biasanya miring (berpusat di waktu cepat namun kadang ada lonjakan ekstrem), distribusinya *TIDAK NORMAL*. Jadi Uji-T (T-Test) tidak bisa dipakai! Skripsi mewajibkan *Mann-Whitney U Test*.

```javascript
79: function mannWhitneyU(sample1, sample2) {
...
85:   const combined = [
86:     ...sample1.map((v) => ({ v, group: 1 })),
87:     ...sample2.map((v) => ({ v, group: 2 })),
88:   ].sort((a, b) => a.v - b.v);
...
107:   const U1 = R1 - (n1 * (n1 + 1)) / 2;
...
116:   // Two-tailed p-value (approx via standard normal CDF)
117:   const p = 2 * normalCDF(-Math.abs(z));
118:   const significant = p < 0.05;
```
- **Baris 85-88:** Algoritma ini menggabungkan latensi IBFT dan QBFT, lalu mengurutkannya (memberikan *Peringkat/Rank*).
- **Baris 107:** Rumus matematika `U-value` yang menghitung seberapa sering latensi grup satu menang melawan grup dua.
- **Baris 116-118:** Hasil tersebut dikonversi menjadi *z-score* lalu dicari persentasenya (*p-value*).
- **Arti `p < 0.05`:** Jika hasil perhitungan menunjukkan kemungkinan kurang dari 5% (0.05), artinya perbedaan performa IBFT dan QBFT itu *SANGAT NYATA*, bukan kebetulan!

### B. Penentuan Titik Jenuh (Saturation Point)
```javascript
181:     // Saturation: throughput stops increasing meaningfully (< 10% increase)
182:     if (prevThroughput > 0 && avgThroughput < prevThroughput * 1.1) {
183:       return { tps, avgThroughput, prevThroughput };
184:     }
```
- Blockchain tidak bisa ditekan terus tanpa batas. Jika kita menyuntik 500 TPS dan ia menghasilkan 400 TPS (Throughput aktual), namun saat disuntik 600 TPS ia tetap stagnan di ~410 TPS (Kenaikan kurang dari 10%), maka skrip ini akan otomatis menyatakan "Jaringan Mencapai Titik Jenuh di 500 TPS".
