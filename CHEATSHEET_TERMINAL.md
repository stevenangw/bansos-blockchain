#  Cheatsheet Perintah Terminal (Bansos Blockchain)

Dokumen ini berisi daftar perintah terminal (*command line prompts*) yang paling sering digunakan dalam proyek sistem Bansos Digital (Hyperledger Besu, Node.js, dan React). Sangat berguna untuk operasional *testing*, *benchmarking*, maupun *development*.

---

##  1. Menu Utama & Automasi (Sangat Sering Digunakan)

Jalankan perintah ini dari *root folder* proyek (`c:\bansos-blockchain-skripsi`):

```powershell
# Membuka menu interaktif utama skripsi (Jalankan semua fitur dari sini)
npm run menu

# Menjalankan aplikasi secara otomatis (Menjalankan Frontend & Backend bersamaan)
node scripts/automation/start_app.js
```

---

##  2. Manajemen Jaringan Blockchain (Docker)

Jika Anda ingin menyalakan, mematikan, atau mereset jaringan blockchain secara manual di luar `npm run menu`.

### Jaringan QBFT
```powershell
cd qbft

# Menyalakan jaringan di latar belakang
docker compose up -d

# Mematikan jaringan
docker compose down

# Melihat log dari node 1 secara real-time
docker logs besu-qbft-node1 -f
```

### Jaringan IBFT 2.0
```powershell
cd ibft2

# Menyalakan jaringan di latar belakang
docker compose up -d

# Mematikan jaringan
docker compose down

# Melihat log dari node 1 secara real-time
docker logs besu-ibft2-node1 -f
```

###  Clean Start (Reset Database Node)
Jika node nyangkut atau rusak karena *chaos injection*, bersihkan *database* menggunakan perintah PowerShell ini dari *root folder*:
```powershell
# Reset data QBFT
Remove-Item -Recurse -Force qbft/node1/data/database, qbft/node1/data/caches, qbft/node2/data/database, qbft/node2/data/caches, qbft/node3/data/database, qbft/node3/data/caches -ErrorAction SilentlyContinue

# Reset data IBFT 2.0
Remove-Item -Recurse -Force ibft2/node1/data/database, ibft2/node1/data/caches, ibft2/node2/data/database, ibft2/node2/data/caches, ibft2/node3/data/database, ibft2/node3/data/caches -ErrorAction SilentlyContinue
```

---

##  3. Menjalankan Komponen Sistem (Manual)

### Menjalankan Frontend (React/Vite Dashboard)
Jika ingin menjalankan antarmuka web secara terpisah:
```powershell
cd c:\bansos-blockchain-skripsi\frontend
npm run dev
# Frontend biasanya akan berjalan di http://localhost:5173
```

### Menjalankan Backend (Node.js API)
Jika ingin menjalankan API server untuk dashboard secara terpisah:
```powershell
cd c:\bansos-blockchain-skripsi\backend
npm run dev
# Backend biasanya akan berjalan di http://localhost:4000
```

---

##  4. Pengembangan Smart Contract (Hardhat)

Perintah ini digunakan ketika Anda mengubah kode program *smart contract* (`.sol`) di folder `contracts/`. Dijalankan dari *root folder*.

```powershell
# Mengkompilasi ulang smart contract
npx hardhat compile
# atau 
npm run compile

# Menjalankan unit tests untuk smart contract
npx hardhat test
# atau
npm run test
```

---

##  5. Network Chaos Injection (Simulasi Jaringan Buruk)

Digunakan untuk melakukan uji stres pada spesifik kontainer docker (misal `besu-qbft-node1`).

```powershell
# Contoh memasukkan latency 100ms (Bisa diganti dengan node target yang diinginkan)
docker exec besu-qbft-node1 tc qdisc add dev eth0 root netem delay 100ms

# Menghapus aturan chaos injection agar jaringan kembali normal
docker exec besu-qbft-node1 tc qdisc del dev eth0 root netem
```

---

##  6. Eksekusi Automasi Manual (Tanpa `menu.js`)

Jika Anda tidak ingin menggunakan menu interaktif (`npm run menu`) dan ingin mengeksekusi *script* pengujian secara langsung dari terminal (*root folder*):

### Setup Jaringan (Deploy, Whitelist, Fund)
```powershell
node scripts/automation/setup.js ibft
node scripts/automation/setup.js qbft
```

### Reset Jaringan (Hapus Database)
```powershell
node scripts/automation/reset_network.js ibft
node scripts/automation/reset_network.js qbft
node scripts/automation/reset_network.js all
```

### Injeksi Transaksi Tanpa Reset (Untuk Demo Frontend/Backend)
Jika Anda **tidak ingin menghapus data blockchain** dan sekadar butuh menembakkan ribuan transaksi ke jaringan yang sudah berjalan untuk didemokan di *frontend/backend*, eksekusi *core orchestrator* secara langsung tanpa menggunakan `run_suite.js`:

```powershell
# Contoh menembak transaksi beruntun ke jaringan IBFT tanpa di-reset:
node --max-old-space-size=8192 --expose-gc scripts/core/orchestrator.js ibft baseline

# Contoh menembak transaksi beruntun ke jaringan QBFT tanpa di-reset:
node --max-old-space-size=8192 --expose-gc scripts/core/orchestrator.js qbft baseline
```
*(Ganti `baseline` dengan profil lain seperti `chaos_latency` jika perlu)*

### Menjalankan Skenario Benchmark Spesifik (Deep Reset)
Perintah ini berguna jika Anda ingin menjalankan skenario benchmark secara utuh (termasuk reset database, setup ulang, lalu inject transaksi). Pastikan jaringan Docker sudah menyala (`docker compose up -d`).

**Untuk IBFT 2.0:**
```powershell
node scripts/automation/run_suite.js ibft baseline
node scripts/automation/run_suite.js ibft chaos_latency
node scripts/automation/run_suite.js ibft chaos_packetloss
node scripts/automation/run_suite.js ibft chaos_combined
```

**Untuk QBFT:**
```powershell
node scripts/automation/run_suite.js qbft baseline
node scripts/automation/run_suite.js qbft chaos_latency
node scripts/automation/run_suite.js qbft chaos_packetloss
node scripts/automation/run_suite.js qbft chaos_combined
```

### Menjalankan Eksekusi Analisa Data
```powershell
node scripts/automation/analyze.js
```

### Menjalankan Full Suite Otomatis (Setup -> Baseline -> Chaos -> Analisis)
```powershell
node scripts/automation/run_suite.js ibft
node scripts/automation/run_suite.js qbft
node scripts/automation/run_suite.js all
```

> [!TIP]
> **Catatan Penting PowerShell:** 
> Pastikan Anda selalu menjalankan terminal sebagai **Administrator** saat bekerja dengan Docker dan menggunakan Windows PowerShell biasa (bukan CMD).
