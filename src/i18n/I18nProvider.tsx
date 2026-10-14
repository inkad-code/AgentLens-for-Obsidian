import { SINGLE_FETCH_REVIEW } from "../core/releaseProfile";
import { createContext, useContext, type ReactNode } from "react";
import { resolveLocale, translate, type Locale, type TranslationKey } from "./catalog";

interface I18nValue {
  locale: Locale;
  t: (key: TranslationKey, values?: Readonly<Record<string, string | number>>) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: "en",
  t: (key, values) => translate("en", key, values)
});

export function I18nProvider({ locale, children }: { locale?: string; children: ReactNode }) {
  const resolved = SINGLE_FETCH_REVIEW ? "en" : resolveLocale(locale);
  return <I18nContext.Provider value={{
    locale: resolved,
    t: (key, values) => translate(resolved, key, values)
  }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
