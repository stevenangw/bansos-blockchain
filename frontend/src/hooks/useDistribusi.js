import { useState } from "react";
import api from "../lib/api";

export function useDistribusi(showToast) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const mintWholesale = async (to, amount) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post("/mint", {
        to,
        amount: parseInt(amount),
      });
      setResult(res.data);
      showToast(`Mint wholesale berhasil: ${amount} token  ${to.slice(0, 10)}...`, "success");
      return true;
    } catch (err) {
      showToast(`Error: ${err.response?.data?.error || err.message}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, result, mintWholesale };
}
