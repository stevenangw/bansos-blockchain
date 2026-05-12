import { useState, useEffect } from "react";
import api from "../lib/api";

export function useTransfer(showToast) {
  const [distributors, setDistributors] = useState([]);
  const [activeDist, setActiveDist] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/distributors", { signal: controller.signal })
      .then((res) => {
        setDistributors(res.data);
        if (res.data.length > 0) {
          setActiveDist(res.data[0].address);
        }
      })
      .catch((err) => {
        if (err.name !== "CanceledError") {
          showToast("Gagal memuat daftar Bank Penyalur", "error");
        }
      });
    return () => controller.abort();
  }, [showToast]);

  useEffect(() => {
    if (!activeDist) return;
    const controller = new AbortController();
    api.get(`/balance/${activeDist}`, { signal: controller.signal })
      .then((res) => {
        setBalance(res.data.balance);
      })
      .catch((err) => {
        if (err.name !== "CanceledError") {
          console.error(err);
        }
      });
    return () => controller.abort();
  }, [activeDist, result]);

  const transferEceran = async (to, amount) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post("/transfer", {
        senderAddress: activeDist,
        to,
        amount: parseInt(amount),
      });
      setResult(res.data);
      showToast(`Transfer eceran berhasil: ${amount} token  ${to.slice(0, 10)}...`, "success");
      return true;
    } catch (err) {
      showToast(`Error: ${err.response?.data?.error || err.message}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { distributors, activeDist, setActiveDist, loading, result, balance, transferEceran };
}
