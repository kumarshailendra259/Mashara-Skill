import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const PermissionContext = createContext({ perms: {}, isAdmin: false, loading: true, can: () => true, reload: () => {} });

export const PermissionProvider = ({ children }) => {
  const { user } = useAuth();
  const [perms, setPerms] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) { setPerms({}); setIsAdmin(false); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get("/auth/me/permissions");
      setPerms(r.data?.permissions || {});
      setIsAdmin(!!r.data?.is_admin);
    } catch {
      // Fail-open so a transient error never locks a user out of their UI.
      setPerms({}); setIsAdmin(true);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  // can(menuId, action) — admin always true; unknown menu defaults to true
  // (backend remains the source of truth / enforcement).
  const can = useCallback((menuId, action = "view") => {
    if (isAdmin) return true;
    const m = perms[menuId];
    if (!m) return true;
    return !!m[action];
  }, [perms, isAdmin]);

  return (
    <PermissionContext.Provider value={{ perms, isAdmin, loading, can, reload }}>
      {children}
    </PermissionContext.Provider>
  );
};

export const usePerm = () => useContext(PermissionContext);
