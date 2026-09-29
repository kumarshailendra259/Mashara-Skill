import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// --- Global Financial Year (FY) selection --------------------------------
// Kept as a module-level variable so the request interceptor can attach it to
// every GET without each page wiring it manually. Updated by FYContext.
let _fy = "all";
try {
  if (typeof localStorage !== "undefined") _fy = localStorage.getItem("mashara_fy") || "all";
} catch { /* ignore */ }

export function setApiFy(v) {
  _fy = v || "all";
}
export function getApiFy() {
  return _fy;
}

/**
 * Read a cookie value from document.cookie by name. Returns null if missing.
 */
function readCookie(name) {
  if (typeof document === "undefined" || !document.cookie) return null;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Auto-attach a fresh `Idempotency-Key` to every POST / PUT / PATCH so the
 * server's per-key store can dedupe double-submits (Phase 32). Also attach
 * the SEC-002 `X-CSRF-Token` header (double-submit cookie pattern) — the
 * backend rejects state-changing requests when this header does not match
 * the `csrf_token` cookie.
 * Callers can override by passing their own header explicitly.
 */
api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  // Attach the globally-selected Financial Year to every GET so finance
  // endpoints filter server-side. Unknown to non-finance endpoints → ignored
  // by FastAPI. Skipped when 'all' (no filter) or when caller set fy explicitly.
  if (method === "get" && _fy && _fy !== "all") {
    config.params = config.params || {};
    if (config.params.fy === undefined) config.params.fy = _fy;
  }
  if (["post", "put", "patch", "delete"].includes(method)) {
    config.headers = config.headers || {};
    if (!config.headers["Idempotency-Key"] && method !== "delete") {
      const uuid =
        (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      config.headers["Idempotency-Key"] = uuid;
    }
    // SEC-002: attach CSRF token from the paired non-httpOnly cookie.
    if (!config.headers["X-CSRF-Token"]) {
      const csrf = readCookie("csrf_token");
      if (csrf) config.headers["X-CSRF-Token"] = csrf;
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
