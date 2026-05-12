import { useState } from "react";
import api from "../lib/api";

export function useUser(showToast) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  const checkSaldo = async (address) => {
    setLoading(true);
    try {
      const [balRes, wlRes] = await Promise.all([
        api.get(`/balance/${address}`),
        api.get(`/whitelist/${address}`),
      ]);
      setResult({ ...balRes.data, whitelisted: wlRes.data.whitelisted });
      return true;
    } catch (err) {
      showToast(`Error: ${err.response?.data?.error || err.message}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const checkRiwayat = async (address) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await api.get(`/history/${address}`);
      setTxs(res.data.transactions || []);
      return true;
    } catch (err) {
      showToast(`Error: ${err.response?.data?.error || err.message}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { result, loading, txs, hasSearched, checkSaldo, checkRiwayat };
}
