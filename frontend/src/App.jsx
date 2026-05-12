import { useState, useCallback, useEffect } from "react";
import "./index.css";
import api from "./lib/api";

// Hooks
import { useDashboard } from "./hooks/useDashboard";
import { useWhitelist } from "./hooks/useWhitelist";
import { useDistribusi } from "./hooks/useDistribusi";
import { useTransfer } from "./hooks/useTransfer";
import { useUser } from "./hooks/useUser";

// Utilities
import { truncateAddress } from "./utils/formatters";

// -- Utility: Copy-to-clipboard button ----------------------------------
function CopyButton({ text, display }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 600);
    } catch {
      /* fallback: ignore */
    }
  };
  return (
    <button
      className="copy-btn"
      onClick={handleCopy}
      title={text}
      aria-label={`Salin ${text}`}
    >
      {display || truncateAddress(text)}
      <span className="copy-icon"></span>
      {copied && <span className="copy-feedback">Tersalin!</span>}
    </button>
  );
}

// -- Utility: Skeleton loader -------------------------------------------
function Skeleton({ width, height, style, className = "" }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: width || "100%", height: height || "14px", ...style }}
    />
  );
}

function SkeletonStatCards({ count = 3 }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat-card" key={i}>
          <Skeleton width="60%" height="12px" style={{ marginBottom: 12 }} />
          <Skeleton width="40%" height="32px" />
        </div>
      ))}
    </div>
  );
}

function SkeletonRows({ count = 4 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div className="skeleton-row" key={i}>
      <Skeleton width="60px" height="22px" style={{ borderRadius: 100 }} />
      <Skeleton width="180px" height="14px" />
      <Skeleton width="50px" height="22px" style={{ borderRadius: 100 }} />
      <Skeleton width="80px" height="30px" style={{ borderRadius: 6 }} />
    </div>
  ));
}

// -- Toast Component ----------------------------------------------------
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`} role="alert">
      <span className="toast-icon">{type === "success" ? "" : ""}</span>
      <span>{message}</span>
    </div>
  );
}

// -- Transaction Detail Modal (Mini Etherscan) --------------------------
function TransactionModal({ tx, onClose }) {
  if (!tx) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3> Detail Transaksi</h3>
          <button
            className="close-button"
            onClick={onClose}
            aria-label="Tutup modal"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="result-row">
            <span className="label">Transaction Hash</span>
            <span className="value">
              <CopyButton text={tx.txHash} />
            </span>
          </div>
          <div className="result-row">
            <span className="label">Status</span>
            <span className="value">
              <span className="badge badge-success"> Berhasil</span>
            </span>
          </div>
          <div className="result-row">
            <span className="label">Block</span>
            <span className="value">#{tx.blockNumber}</span>
          </div>
          <div className="result-row">
            <span className="label">Dari (Pengirim)</span>
            <span className="value">
              <CopyButton text={tx.from} />
            </span>
          </div>
          <div className="result-row">
            <span className="label">Ke (Penerima)</span>
            <span className="value">
              <CopyButton text={tx.to} />
            </span>
          </div>
          <div className="result-row">
            <span className="label">Jumlah Token</span>
            <span
              className="value"
              style={{ fontWeight: 700, fontSize: "16px" }}
            >
              {Number(tx.amount).toLocaleString("id-ID")} BANSOS
            </span>
          </div>
          <div
            className="result-row"
            style={{ marginTop: 16, borderBottom: "none" }}
          >
            <span
              className="label"
              style={{ fontSize: 12, color: "var(--text-muted)" }}
            >
              Catatan: Data ditarik langsung dari node Hyperledger Besu lokal
              Anda.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Admin: Dashboard ---------------------------------------------------
function AdminDashboard() {
  const { info, loading, error, fetchInfo } = useDashboard();

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Ringkasan informasi sistem distribusi bansos digital</p>
      </div>

      {loading ? (
        <>
          <SkeletonStatCards count={3} />
          <div className="card">
            <Skeleton width="30%" height="16px" style={{ marginBottom: 20 }} />
            <Skeleton width="100%" height="14px" style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height="14px" style={{ marginBottom: 12 }} />
            <Skeleton width="80%" height="14px" />
          </div>
        </>
      ) : error ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"></div>
            <p>Tidak dapat terhubung ke backend</p>
            <p className="empty-hint">Pastikan server berjalan di port 4000</p>
            <button
              className="btn btn-outline"
              style={{ marginTop: 16 }}
              onClick={fetchInfo}
            >
              Coba Lagi
            </button>
          </div>
        </div>
      ) : (
        info && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total Supply Token</div>
                <div className="stat-value">
                  {Number(info.totalSupply).toLocaleString("id-ID")}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Block Saat Ini</div>
                <div className="stat-value">
                  {info.blockNumber?.toLocaleString("id-ID")}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Jaringan</div>
                <div className="stat-value">{info.network}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Informasi Kontrak</div>
              <div className="result-box">
                <div className="result-row">
                  <span className="label">Alamat Kontrak</span>
                  <span className="value">
                    <CopyButton text={info.contractAddress} />
                  </span>
                </div>
                <div className="result-row">
                  <span className="label">Admin</span>
                  <span className="value">
                    <CopyButton text={info.admin} />
                  </span>
                </div>
                <div className="result-row">
                  <span className="label">RPC Endpoint</span>
                  <span className="value">{info.providerUrl}</span>
                </div>
                <div className="result-row">
                  <span className="label">Protokol Konsensus</span>
                  <span className="value">{info.network}</span>
                </div>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

// -- Admin: Whitelist ---------------------------------------------------
function AdminWhitelist({ showToast }) {
  const [address, setAddress] = useState("");
  const { whitelists, loadingList, loading, addWhitelist, toggleWhitelistStatus, refreshWhitelists } = useWhitelist(showToast);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!address) return;
    const success = await addWhitelist(address);
    if (success) {
      setAddress("");
    }
  };

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Manajemen Whitelist</h2>
        <p>Kelola daftar penerima bansos yang berhak melakukan transaksi</p>
      </div>

      <div className="card">
        <div className="card-title">Tambah Penerima Baru</div>
        <form onSubmit={handleSubmit} className="form-inline">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Alamat Penerima</label>
            <input
              className="form-input"
              placeholder="0x..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !address}
            style={{ alignSelf: "flex-end" }}
          >
            {loading ? <div className="spinner" /> : "Tambahkan ke Whitelist"}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Daftar Whitelist
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={refreshWhitelists}
          >
            {loadingList ? "Memuat..." : "Refresh"}
          </button>
        </div>

        {loadingList && whitelists.length === 0 ? (
          <div className="table-wrapper" style={{ padding: "0 32px 32px" }}>
            <SkeletonRows count={4} />
          </div>
        ) : whitelists.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Peran</th>
                  <th>Alamat Dompet</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {whitelists.map((item, i) => (
                  <tr key={i}>
                    <td>
                      <span
                        className={`badge ${
                          item.role === "Bank Penyalur"
                            ? "badge-info"
                            : "badge-warning"
                        }`}
                      >
                        {item.role}
                      </span>
                    </td>
                    <td className="addr">
                      <CopyButton text={item.address} />
                    </td>
                    <td>
                      {item.status ? (
                        <span className="badge badge-success">Aktif</span>
                      ) : (
                        <span className="badge badge-danger">Nonaktif</span>
                      )}
                    </td>
                    <td>
                      {item.status ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => toggleWhitelistStatus(item.address, item.status)}
                        >
                          Cabut Akses
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-success-subtle btn-sm"
                          onClick={() => toggleWhitelistStatus(item.address, item.status)}
                        >
                          Beri Akses
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon"></div>
            <p>Belum ada alamat yang terdaftar di whitelist.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Admin: Distribusi Token (Wholesale) --------------------------------
function AdminDistribusi({ showToast }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const { loading, result, mintWholesale } = useDistribusi(showToast);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!to || !amount) return;
    await mintWholesale(to, amount);
  };

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Mint Wholesale (BI ke Bank Penyalur)</h2>
        <p>
          Cetak token baru ke alamat dompet Bank Penyalur yang sudah
          di-whitelist
        </p>
      </div>

      <div className="card">
        <div className="card-title">Mint Token</div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Alamat Bank Penyalur</label>
              <input
                className="form-input"
                placeholder="0x..."
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Jumlah Token</label>
              <input
                className="form-input"
                type="number"
                placeholder="10000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-success"
            disabled={loading || !to || !amount}
          >
            {loading ? (
              <>
                <div className="spinner" /> Memproses...
              </>
            ) : (
              "Mint ke Bank Penyalur"
            )}
          </button>
        </form>

        {result && (
          <div className="result-box">
            <h4>Transaksi Berhasil</h4>
            <div className="result-row">
              <span className="label">Penerima</span>
              <span className="value">
                <CopyButton text={result.to} />
              </span>
            </div>
            <div className="result-row">
              <span className="label">Jumlah</span>
              <span className="value">
                {result.amount?.toLocaleString("id-ID")} token
              </span>
            </div>
            <div className="result-row">
              <span className="label">TX Hash</span>
              <span className="value">
                <CopyButton text={result.txHash} />
              </span>
            </div>
            <div className="result-row">
              <span className="label">Block</span>
              <span className="value">#{result.blockNumber}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Bank Penyalur: Distribusi Token (Retail) ---------------------------
function DistributorTransfer({ showToast }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const { distributors, activeDist, setActiveDist, loading, result, balance, transferEceran } = useTransfer(showToast);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!to || !amount || !activeDist) return;
    await transferEceran(to, amount);
  };

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Distribusi Eceran (Bank Penyalur ke KPM)</h2>
        <p>Transfer token bansos dari Bank Penyalur ke penerima (KPM)</p>
      </div>

      <div className="card" style={{ marginBottom: "var(--space-5)" }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Pilih Bank Penyalur (Sender)</label>
          <select
            className="form-input"
            value={activeDist}
            onChange={(e) => setActiveDist(e.target.value)}
          >
            {distributors.map((d) => (
              <option key={d.address} value={d.address}>
                {d.name} ({truncateAddress(d.address)})
              </option>
            ))}
          </select>
        </div>
        {balance !== null && (
          <div className="balance-display">
            Saldo Tersedia:{" "}
            <strong style={{ color: "var(--accent)" }}>
              {Number(balance).toLocaleString("id-ID")} BANSOS
            </strong>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Transfer Bansos ke KPM</div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Alamat Penerima (KPM)</label>
              <input
                className="form-input"
                placeholder="0x..."
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Jumlah Token</label>
              <input
                className="form-input"
                type="number"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !to || !amount}
          >
            {loading ? (
              <>
                <div className="spinner" /> Mengirim...
              </>
            ) : (
              "Kirim Token ke KPM"
            )}
          </button>
        </form>

        {result && (
          <div className="result-box">
            <h4>Transaksi Berhasil</h4>
            <div className="result-row">
              <span className="label">Pengirim</span>
              <span className="value">
                <CopyButton text={result.sender} />
              </span>
            </div>
            <div className="result-row">
              <span className="label">Penerima</span>
              <span className="value">
                <CopyButton text={result.to} />
              </span>
            </div>
            <div className="result-row">
              <span className="label">Jumlah</span>
              <span className="value" style={{ fontWeight: 700 }}>
                {result.amount?.toLocaleString("id-ID")} BANSOS
              </span>
            </div>
            <div className="result-row">
              <span className="label">TX Hash</span>
              <span className="value">
                <CopyButton text={result.txHash} />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- User: Cek Saldo ----------------------------------------------------
function UserSaldo({ showToast }) {
  const [address, setAddress] = useState("");
  const { result, loading, checkSaldo } = useUser(showToast);

  const handleCheck = async (e) => {
    e.preventDefault();
    if (!address) return;
    await checkSaldo(address);
  };

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Cek Saldo & Status</h2>
        <p>Periksa saldo token bansos dan status whitelist Anda</p>
      </div>

      <div className="card">
        <div className="card-title">Informasi Akun</div>
        <form onSubmit={handleCheck} className="form-inline">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Alamat Wallet Anda</label>
            <input
              className="form-input"
              placeholder="0x..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !address}
            style={{ alignSelf: "flex-end" }}
          >
            {loading ? <div className="spinner" /> : "Cek Saldo"}
          </button>
        </form>

        {result && (
          <div style={{ marginTop: "var(--space-6)" }}>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Saldo Token Bansos</div>
                <div className="stat-value">
                  {Number(result.balance).toLocaleString("id-ID")}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Status Whitelist</div>
                <div style={{ marginTop: "var(--space-2)" }}>
                  {result.whitelisted ? (
                    <span className="badge badge-success"> Terdaftar</span>
                  ) : (
                    <span className="badge badge-danger">
                       Tidak Terdaftar
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="result-box">
              <div className="result-row">
                <span className="label">Alamat</span>
                <span className="value">
                  <CopyButton text={result.address} />
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- User: Riwayat Transaksi --------------------------------------------
function UserRiwayat({ showToast }) {
  const [address, setAddress] = useState("");
  const [selectedTx, setSelectedTx] = useState(null);
  const { txs, loading, hasSearched, checkRiwayat } = useUser(showToast);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!address) return;
    await checkRiwayat(address);
  };

  return (
    <div className="page-transition">
      <div className="page-header">
        <h2>Riwayat Transaksi</h2>
        <p>Lihat riwayat transfer token bansos masuk dan keluar</p>
      </div>

      <div className="card">
        <form onSubmit={handleSearch} className="form-inline">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Alamat Wallet</label>
            <input
              className="form-input"
              placeholder="0x..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !address}
            style={{ alignSelf: "flex-end" }}
          >
            Cari Riwayat
          </button>
        </form>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrapper" style={{ padding: "32px" }}>
            <SkeletonRows count={4} />
          </div>
        </div>
      ) : hasSearched && txs.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="card-header">
            <div className="card-title" style={{ marginBottom: 0 }}>{txs.length} Transaksi Ditemukan</div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Tipe</th>
                  <th>Dari</th>
                  <th>Ke</th>
                  <th>Jumlah</th>
                  <th>Block</th>
                  <th>TX Hash</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((tx, i) => (
                  <tr key={i}>
                    <td>
                      {tx.type === "IN" ? (
                        <span className="badge badge-success"> Masuk</span>
                      ) : (
                        <span className="badge badge-warning"> Keluar</span>
                      )}
                    </td>
                    <td className="addr">
                      <CopyButton
                        text={tx.from}
                        display={truncateAddress(tx.from)}
                      />
                    </td>
                    <td className="addr">
                      <CopyButton text={tx.to} display={truncateAddress(tx.to)} />
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {Number(tx.amount).toLocaleString("id-ID")}
                    </td>
                    <td className="mono">#{tx.blockNumber}</td>
                    <td className="mono" style={{ color: "var(--text-muted)" }}>
                      <span
                        className="tx-hash-link"
                        onClick={() => setSelectedTx(tx)}
                      >
                        {truncateAddress(tx.txHash, 8, 6)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : hasSearched && txs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"></div>
            <p>Belum ada riwayat transaksi untuk alamat ini</p>
          </div>
        </div>
      ) : null}

      {selectedTx && (
        <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}
    </div>
  );
}

// -- Main App -----------------------------------------------------------
const ADMIN_PAGES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "whitelist", label: "Whitelist" },
  { id: "distribusi", label: "Mint Wholesale" },
];

const DISTRIBUTOR_PAGES = [{ id: "dist_transfer", label: "Distribusi Eceran" }];

const USER_PAGES = [
  { id: "saldo", label: "Cek Saldo" },
  { id: "riwayat", label: "Riwayat Transaksi" },
];

export default function App() {
  const [role, setRole] = useState("admin");
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [networkName, setNetworkName] = useState("Menghubungkan...");

  useEffect(() => {
    api.get("/info")
      .then((r) => {
        if (r.data && r.data.network) {
          setNetworkName(`${r.data.network} Network - Besu`);
        } else {
          setNetworkName("Jaringan Tidak Dikenal");
        }
      })
      .catch(() => {
        setNetworkName("Terputus");
      });
  }, []);

  const showToast = useCallback((message, type) => {
    setToast({ message, type, key: Date.now() });
  }, []);

  let pages = USER_PAGES;
  if (role === "admin") pages = ADMIN_PAGES;
  if (role === "distributor") pages = DISTRIBUTOR_PAGES;

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    if (newRole === "admin") setPage("dashboard");
    else if (newRole === "distributor") setPage("dist_transfer");
    else setPage("saldo");
  };

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <AdminDashboard />;
      case "whitelist":
        return <AdminWhitelist showToast={showToast} />;
      case "distribusi":
        return <AdminDistribusi showToast={showToast} />;
      case "dist_transfer":
        return <DistributorTransfer showToast={showToast} />;
      case "saldo":
        return <UserSaldo showToast={showToast} />;
      case "riwayat":
        return <UserRiwayat showToast={showToast} />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          key={toast.key}
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div>
              <h1>Bansos Digital</h1>
              <div className="subtitle">Blockchain System</div>
            </div>
          </div>
        </div>

        <div className="role-selector">
          <div className="role-tabs" role="tablist" aria-label="Pilih Peran">
            <button
              role="tab"
              aria-selected={role === "admin"}
              className={`role-tab ${role === "admin" ? "active" : ""}`}
              onClick={() => handleRoleChange("admin")}
            >
              Admin
            </button>
            <button
              role="tab"
              aria-selected={role === "distributor"}
              className={`role-tab ${role === "distributor" ? "active" : ""}`}
              onClick={() => handleRoleChange("distributor")}
            >
              Penyalur
            </button>
            <button
              role="tab"
              aria-selected={role === "user"}
              className={`role-tab ${role === "user" ? "active" : ""}`}
              onClick={() => handleRoleChange("user")}
            >
              KPM
            </button>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Menu Utama">
          <div className="nav-group-label" id="nav-heading">
            {role === "admin"
              ? "Menu Admin"
              : role === "distributor"
              ? "Menu Bank Penyalur"
              : "Menu Penerima (KPM)"}
          </div>
          {pages.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${page === p.id ? "active" : ""}`}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="network-badge">
            <div className={`dot ${networkName === "Terputus" ? "offline" : ""}`} />
            {networkName}
          </div>
        </div>
      </aside>

      <main className="main-content">{renderPage()}</main>
    </>
  );
}
