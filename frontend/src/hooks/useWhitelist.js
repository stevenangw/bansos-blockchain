import { useState, useEffect, useCallback } from "react";
import api from "../lib/api";

export function useWhitelist(showToast) {
  const [whitelists, setWhitelists] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loading, setLoading] = useState(false);

  const refreshWhitelists = useCallback(async (isInitial) => {
    const controller = new AbortController();
    if (isInitial !== true) {
      setLoadingList(true);
    }
    try {
      const res = await api.get("/whitelists", { signal: controller.signal });
      setWhitelists(res.data);
    } catch (err) {
      if (err.name !== "CanceledError") {
        showToast(`Gagal memuat daftar whitelist: ${err.response?.data?.error || err.message}`, "error");
      }
    } finally {
      setLoadingList(false);
    }
    return controller;
  }, [showToast]);

  useEffect(() => {
    let controller;
    const t = setTimeout(() => {
      refreshWhitelists(true).then(ctrl => controller = ctrl);
    }, 0);
    return () => {
      clearTimeout(t);
      if (controller) controller.abort();
    };
  }, [refreshWhitelists]);

  const addWhitelist = async (address) => {
    setLoading(true);
    try {
      await api.post("/whitelist", { address, status: true });
      showToast(`Whitelist ditambahkan: ${address.slice(0, 10)}...`, "success");
      setLoadingList(true);
      await refreshWhitelists();
      return true;
    } catch (err) {
      showToast(`Error: ${err.response?.data?.error || err.message}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const toggleWhitelistStatus = async (itemAddress, currentStatus) => {
    try {
      await api.post("/whitelist", {
        address: itemAddress,
        status: !currentStatus,
      });
      showToast(
        `Status diperbarui: ${itemAddress.slice(0, 8)}... menjadi ${!currentStatus ? "Aktif" : "Nonaktif"}`,
        "success"
      );
      setLoadingList(true);
      await refreshWhitelists();
    } catch (err) {
      showToast(`Gagal mengubah status: ${err.response?.data?.error || err.message}`, "error");
    }
  };

  return { whitelists, loadingList, loading, addWhitelist, toggleWhitelistStatus, refreshWhitelists };
}
