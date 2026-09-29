import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import { setApiFy } from "@/lib/api";
import { FY_ALL, fyOptions } from "@/lib/fy";

const KEY = "mashara_fy";
const FYContext = createContext(null);

function readInitial() {
  try {
    const v = localStorage.getItem(KEY);
    return v || FY_ALL;
  } catch {
    return FY_ALL;
  }
}

export function FYProvider({ children }) {
  const [fy, _setFy] = useState(readInitial);

  // Keep the api-layer module variable in sync so the request interceptor can
  // attach `fy` to every finance GET (covers pages that don't wire it explicitly).
  useEffect(() => { setApiFy(fy); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFy = useCallback((v) => {
    const val = v || FY_ALL;
    setApiFy(val); // synchronous — module var updated BEFORE any refetch fires
    try { localStorage.setItem(KEY, val); } catch { /* ignore */ }
    _setFy(val);
  }, []);

  return (
    <FYContext.Provider value={{ fy, setFy, options: fyOptions() }}>
      {children}
    </FYContext.Provider>
  );
}

export function useFY() {
  const ctx = useContext(FYContext);
  if (!ctx) return { fy: FY_ALL, setFy: () => {}, options: fyOptions() };
  return ctx;
}
