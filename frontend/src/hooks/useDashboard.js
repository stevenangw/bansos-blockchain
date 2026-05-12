import { useState, useEffect, useCallback } from "react";
import api from "../lib/api";

export function useDashboard() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchInfo = useCallback((isInitial) => {
    const controller = new AbortController();
    if (isInitial !== true) {
      setLoading(true);
      setError(false);
    }
    
    api.get("/info", { signal: controller.signal })
      .then((r) => setInfo(r.data))
      .catch((err) => {
        if (err.name !== "CanceledError") {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
      
    return controller;
  }, []);

  useEffect(() => {
    let controller;
    const t = setTimeout(() => {
      controller = fetchInfo(true);
    }, 0);
    return () => {
      clearTimeout(t);
      if (controller) controller.abort();
    };
  }, [fetchInfo]);

  return { info, loading, error, fetchInfo };
}
