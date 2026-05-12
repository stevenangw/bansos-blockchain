# Bansos Blockchain

> Sistem Penyaluran Bantuan Sosial Digital Berbasis Blockchain  
> Proyek Skripsi -- Dibuat dengan Hyperledger Besu, Solidity, Express.js, dan React

---

## Deskripsi

Bansos Blockchain adalah sistem prototipe untuk mengelola **penyaluran bantuan sosial (bansos) secara digital** menggunakan teknologi blockchain. Sistem ini memanfaatkan **smart contract** di jaringan **Hyperledger Besu** untuk menjamin transparansi, keamanan, dan akuntabilitas dalam distribusi dana bantuan kepada Keluarga Penerima Manfaat (KPM).

Proyek ini dibuat sebagai bagian dari penelitian skripsi yang membandingkan performa dua algoritma konsensus: **IBFT 2.0** dan **QBFT**.

---

## Arsitektur Sistem

```
+-------------------+       +-------------------+       +----------------------------+
|                   |       |                   |       |                            |
|  Frontend (React) | <---> |  Backend (Express) | <---> |  Hyperledger Besu Network  |
|  Vite + Axios     |  API  |  ethers.js         |  RPC  |  IBFT 2.0 / QBFT          |
|                   |       |                   |       |  (3 Node via Docker)       |
+-------------------+       +-------------------+       +----------------------------+
                                                                    |
                                                          +---------+---------+
                                                          |  Smart Contract   |
                                                          |  BansosToken.sol  |
                                                          +-------------------+
```

- **Frontend**: Dashboard web untuk admin mengelola whitelist, mint token, transfer dana, dan memonitor transaksi.
- **Backend**: REST API sebagai middleware antara frontend dan blockchain menggunakan `ethers.js`.
- **Blockchain**: Jaringan private Hyperledger Besu yang berjalan secara lokal melalui Docker Compose (3 node validator).
- **Smart Contract**: `BansosToken.sol` -- token custom untuk merepresentasikan dana bantuan sosial.

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| **Whitelist Management** | Admin dapat mendaftarkan atau mencabut akses alamat (Bank Penyalur & KPM) |
| **Token Minting** | Admin mencetak token bantuan ke alamat yang sudah di-whitelist |
| **Token Transfer** | Bank Penyalur mendistribusikan token ke KPM |
| **Transaction History** | Melihat riwayat transaksi per alamat secara real-time |
| **Multi-Consensus** | Mendukung jaringan IBFT 2.0 dan QBFT secara terpisah |
| **Automated Benchmark** | Skrip otomasi untuk uji performa (throughput, latency, resource usage) |
| **Dashboard Interaktif** | UI modern dengan monitoring status jaringan blockchain |

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| **Blockchain** | Hyperledger Besu 24.x, Docker, Docker Compose |
| **Smart Contract** | Solidity 0.8.20, Hardhat |
| **Backend** | Node.js, Express.js 5, ethers.js 6 |
| **Frontend** | React 19, Vite 8, Axios |
| **Testing** | Hardhat Test, Chai, Mocha |

---

## Persyaratan Sistem

Pastikan software berikut sudah terinstal di komputer kamu:

- **[Node.js](https://nodejs.org/)** versi 18 atau lebih baru
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (untuk menjalankan jaringan blockchain)
- **[Git](https://git-scm.com/)** (untuk clone repository)

Untuk verifikasi instalasi, jalankan:

```bash
node --version    # Minimal v18.x.x
docker --version  # Minimal v20.x.x
git --version     # Versi apapun
```

---

## Cara Menjalankan

### 1. Clone Repository

```bash
git clone https://github.com/<username>/bansos-blockchain.git
cd bansos-blockchain
```

> Ganti `<username>` dengan username GitHub kamu.

### 2. Konfigurasi Environment

Salin file `.env.example` menjadi `.env` di **tiga lokasi**:

```bash
# Root project (untuk Hardhat)
cp .env.example .env

# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

> **Catatan:** File `.env` berisi konfigurasi lokal dan sudah masuk `.gitignore`, jadi **tidak akan terunggah ke GitHub**.

### 3. Install Dependencies

```bash
# Root (Hardhat & scripts)
npm install

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install

# Kembali ke root
cd ..
```

### 4. Jalankan Jaringan Blockchain

Pilih salah satu jaringan konsensus:

```bash
# Jaringan IBFT 2.0
npm run setup:ibft

# ATAU jaringan QBFT
npm run setup:qbft
```

Perintah ini akan:
- Menjalankan 3 node Hyperledger Besu via Docker
- Compile dan deploy smart contract
- Menyimpan alamat kontrak di `logs/contract_addresses.json`

### 5. Jalankan Aplikasi (Frontend + Backend)

```bash
npm run website
```

Perintah ini akan menjalankan backend (port 5000) dan frontend (port 5173) secara bersamaan. Buka browser dan akses:

```
http://localhost:5173
```

---

## Struktur Proyek

```
bansos-blockchain/
|
|-- contracts/                 # Smart contract Solidity
|   +-- BansosToken.sol        # Token untuk distribusi bansos
|
|-- backend/                   # REST API server
|   |-- index.js               # Entry point backend (Express)
|   |-- .env.example           # Template environment variables
|   +-- package.json
|
|-- frontend/                  # Dashboard web
|   |-- src/
|   |   |-- App.jsx            # Komponen utama aplikasi
|   |   |-- index.css          # Styling utama
|   |   |-- hooks/             # Custom React hooks
|   |   |-- lib/               # Library/utility
|   |   +-- utils/             # Helper functions
|   |-- index.html
|   |-- .env.example
|   +-- package.json
|
|-- scripts/                   # Skrip otomasi & benchmark
|   |-- automation/            # Setup, reset, benchmark runner
|   |-- core/                  # Orchestrator & benchmark engine
|   +-- menu.js                # Menu interaktif CLI
|
|-- ibft2/                     # Konfigurasi jaringan IBFT 2.0
|   |-- docker-compose.yml
|   |-- genesis.json
|   +-- node1/, node2/, node3/
|
|-- qbft/                      # Konfigurasi jaringan QBFT
|   |-- docker-compose.yml
|   |-- genesis.json
|   +-- node1/, node2/, node3/
|
|-- test/                      # Unit test smart contract
|   +-- BansosToken.test.js
|
|-- logs/                      # Output benchmark & alamat kontrak
|-- hardhat.config.js          # Konfigurasi Hardhat
|-- package.json               # Dependencies utama
+-- .gitignore
```

---

## Perintah yang Tersedia

| Perintah | Deskripsi |
|---|---|
| `npm run website` | Jalankan frontend + backend secara otomatis |
| `npm run setup:ibft` | Setup jaringan IBFT 2.0 (Docker + deploy contract) |
| `npm run setup:qbft` | Setup jaringan QBFT (Docker + deploy contract) |
| `npm run reset:ibft` | Reset jaringan IBFT 2.0 |
| `npm run reset:qbft` | Reset jaringan QBFT |
| `npm run reset:all` | Reset semua jaringan |
| `npm run benchmark` | Jalankan benchmark otomatis |
| `npm run suite:ibft` | Jalankan test suite IBFT 2.0 |
| `npm run suite:qbft` | Jalankan test suite QBFT |
| `npm run suite:all` | Jalankan test suite semua jaringan |
| `npm run analyze` | Analisis hasil benchmark |
| `npm run menu` | Buka menu interaktif CLI |
| `npm run compile` | Compile smart contract |
| `npm test` | Jalankan unit test smart contract |

---

## API Endpoints

Backend berjalan di `http://localhost:5000` dengan endpoint berikut:

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/info` | Info jaringan, admin, total supply |
| `GET` | `/api/distributors` | Daftar Bank Penyalur |
| `GET` | `/api/balance/:address` | Cek saldo token suatu alamat |
| `GET` | `/api/whitelist/:address` | Cek status whitelist suatu alamat |
| `GET` | `/api/whitelists` | Daftar semua alamat whitelist |
| `GET` | `/api/history/:address` | Riwayat transaksi suatu alamat |
| `POST` | `/api/whitelist` | Tambah/ubah whitelist `{ address, status }` |
| `POST` | `/api/mint` | Mint token `{ to, amount }` |
| `POST` | `/api/transfer` | Transfer token `{ senderAddress, to, amount }` |

---

## Smart Contract

**BansosToken** (`contracts/BansosToken.sol`) adalah token custom yang merepresentasikan dana bantuan sosial digital.

**Spesifikasi:**
- Nama: `Bansos Digital`
- Simbol: `BANSOS`
- Desimal: `0` (token tidak bisa dipecah, 1 token = 1 unit bantuan)
- Kontrol Akses: Hanya **admin** (deployer) yang dapat mint dan mengatur whitelist
- Whitelist: Hanya alamat yang sudah di-whitelist yang bisa menerima token

**Fungsi Utama:**
- `mint(address to, uint256 amount)` -- Cetak token baru (admin only)
- `setWhitelist(address account, bool status)` -- Atur whitelist (admin only)
- `transfer(address to, uint256 amount)` -- Transfer token ke alamat whitelist
- `balanceOf(address account)` -- Cek saldo token
- `totalSupply()` -- Total token yang beredar

---

## Dokumentasi Tambahan

| Dokumen | Deskripsi |
|---|---|
| [Penjelasan Kode Skripsi](PENJELASAN_KODE_SKRIPSI.md) | Penjelasan detail implementasi kode |
| [Dokumen Benchmark](DOKUMEN_CORE_BENCHMARK.md) | Dokumentasi engine benchmark |
| [Dokumen Monitor & Analisis](DOKUMEN_MONITOR_ANALISIS.md) | Dokumentasi monitoring & analisis |
| [Dokumen Setup Menu](DOKUMEN_SETUP_MENU.md) | Panduan menu interaktif |
| [Dokumen Utilitas Tambahan](DOKUMEN_UTILITAS_TAMBAHAN.md) | Utilitas pendukung |
| [Cheatsheet Terminal](CHEATSHEET_TERMINAL.md) | Perintah-perintah berguna |

---

## Panduan Upload ke GitHub (untuk Pemula)

Berikut langkah-langkah untuk mengupload proyek ini ke GitHub:

### 1. Buat Repository Baru di GitHub

1. Buka [github.com](https://github.com) dan login
2. Klik tombol **"+"** di kanan atas, pilih **"New repository"**
3. Isi nama repository (misal: `bansos-blockchain`)
4. Pilih **Public** atau **Private**
5. **Jangan** centang "Add a README file" (sudah ada)
6. Klik **"Create repository"**

### 2. Upload dari Komputer

Buka terminal di folder proyek, lalu jalankan:

```bash
# Inisialisasi git (jika belum)
git init

# Tambahkan semua file
git add .

# Buat commit pertama
git commit -m "Initial commit: Bansos Blockchain System"

# Hubungkan ke repository GitHub
git remote add origin https://github.com/<username>/bansos-blockchain.git

# Push ke GitHub
git branch -M main
git push -u origin main
```

> Ganti `<username>` dengan username GitHub kamu.

### 3. Verifikasi

Buka halaman repository di GitHub dan pastikan semua file sudah terunggah. File `.env` dan `node_modules/` seharusnya **tidak** muncul karena sudah tercantum di `.gitignore`.

---

## Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).
