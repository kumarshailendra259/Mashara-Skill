import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { dictionary } from "@/lib/i18n";

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en");

  const switchLang = useCallback((l) => {
    localStorage.setItem("lang", l);
    setLang(l);
  }, []);

  const t = useCallback(
    (key) => dictionary[lang]?.[key] || dictionary.en[key] || key,
    [lang],
  );

  const value = useMemo(() => ({ lang, switchLang, t }), [lang, switchLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
