import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Response interceptor for global error handling and retries
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    
    // Retry logic (max 3x)
    if (!config || !config.retry) {
      config.retry = 0;
    }
    
    if (config.retry < 3 && (!error.response || error.response.status >= 500 || error.code === 'ECONNABORTED')) {
      config.retry += 1;
      const backoff = new Promise((resolve) => {
        setTimeout(() => resolve(), 1000 * Math.pow(2, config.retry - 1)); // Exponential backoff
      });
      await backoff;
      return api(config);
    }
    
    // Standardized error wrapping
    if (error.response) {
      if (error.response.status === 401) {
        console.warn("Unauthorized access");
      } else if (error.response.status >= 500) {
        console.error("Server error encountered", error.response.data);
      }
    } else if (error.request) {
      console.error("Network error, no response received");
    }
    
    return Promise.reject(error);
  }
);

export default api;
