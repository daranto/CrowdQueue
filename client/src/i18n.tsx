import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  localeFor,
  translate,
  translateServerMessage,
  type Language,
  type TranslationValues,
} from "./locales";

interface I18nValue {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: TranslationValues) => string;
  serverMessage: (message: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(detectLanguage);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
    if (skipLink) skipLink.textContent = translate(language, "Zum Inhalt springen");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", translate(language, "Gemeinsam die Musik für deine Party bestimmen."));
  }, [language]);

  const value = useMemo<I18nValue>(() => ({
    language,
    locale: localeFor(language),
    setLanguage,
    t: (key, values) => translate(language, key, values),
    serverMessage: (message) => translateServerMessage(language, message),
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
