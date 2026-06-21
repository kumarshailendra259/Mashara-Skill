import React, { createContext, useContext, useState } from "react";
import { dictionary } from "@/lib/i18n";

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en");

  const switchLang = (l) => {
    localStorage.setItem("lang", l);
    setLang(l);
  };

  const t = (key) => dictionary[lang]?.[key] || dictionary.en[key] || key;

  return (
    <LangContext.Provider value={{ lang, switchLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);
