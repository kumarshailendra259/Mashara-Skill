import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
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
