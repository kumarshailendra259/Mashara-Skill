import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

/**
 * Auto-attach a fresh `Idempotency-Key` to every POST / PUT / PATCH so the
 * server's per-key store can dedupe double-submits (Phase 32). Callers can
 * override by passing their own header explicitly.
 */
api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch"].includes(method)) {
    config.headers = config.headers || {};
    if (!config.headers["Idempotency-Key"]) {
      // Use browser crypto if available, else fall back to a timestamped random.
      const uuid =
        (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      config.headers["Idempotency-Key"] = uuid;
    }
  }
  return config;
});

export function formatError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || "Request failed";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .join(" ");
  }
  if (typeof d?.msg === "string") return d.msg;
  return String(d);
}
