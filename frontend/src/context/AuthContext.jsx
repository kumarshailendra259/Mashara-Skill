import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = unknown, false = guest, object = user
  const [loading, setLoading] = useState(true);
  // Phase 65 — Center-based data isolation scope.
  const [scope, setScope] = useState(null);
  // Phase 72 — multi-company: the companies this user can access + which one is active.
  const [companies, setCompanies] = useState([]);
  const [isSuperCompanies, setIsSuperCompanies] = useState(false);

  const loadCompanies = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/my-companies");
      setCompanies(data.companies || []);
      setIsSuperCompanies(!!data.is_super_admin);
      return data;
    } catch {
      setCompanies([]);
      setIsSuperCompanies(false);
      return null;
    }
  }, []);

  const hydrate = useCallback(async () => {
    try {
      const s = await api.get("/auth/me/scope");
      setScope(s.data);
    } catch { setScope(null); }
    await loadCompanies();
  }, [loadCompanies]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      await hydrate();
    } catch {
      setUser(false);
      setScope(null);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      // New login → force the company selector to show again (requirement 4b).
      try { sessionStorage.removeItem("companyChosen"); } catch { /* ignore */ }
      await hydrate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }, [hydrate]);

  const switchCompany = useCallback(async (companyId) => {
    try {
      await api.post("/auth/switch-company", { company_id: companyId });
      try { sessionStorage.setItem("companyChosen", "1"); } catch { /* ignore */ }
      // Re-pull user + scope so role/centers reflect the newly active company.
      const { data } = await api.get("/auth/me");
      setUser(data);
      await hydrate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }, [hydrate]);

  const startTrial = useCallback(async () => {
    try {
      await api.post("/subscription/start-trial");
      await hydrate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }, [hydrate]);

  const register = useCallback(async (payload) => {
    try {
      const { data } = await api.post("/auth/register", payload);
      setUser(data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch { /* best-effort */ }
    try { sessionStorage.removeItem("companyChosen"); } catch { /* ignore */ }
    setUser(false);
    setCompanies([]);
  }, []);

  const value = useMemo(
    () => ({
      user, loading, scope, companies, isSuperCompanies,
      login, register, logout, refresh, switchCompany, loadCompanies, startTrial,
    }),
    [user, loading, scope, companies, isSuperCompanies, login, register, logout, refresh, switchCompany, loadCompanies, startTrial],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
