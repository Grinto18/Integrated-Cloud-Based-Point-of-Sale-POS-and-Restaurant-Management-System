import React, { createContext, useContext, useState, useEffect } from 'react';
import { Role } from '../types.ts';

export type AppLanguage = 'ar' | 'fr';

interface LanguageContextType {
  lang: AppLanguage;
  isRtl: boolean;
  setLang: (lang: AppLanguage) => void;
  toggleLang: () => void;
  applyDefaultLanguage: (defaultLang?: string | null) => void;
  t: (ar: string, fr: string) => string;
  roleLabel: (role?: Role | string | null) => string;
}

const LANG_STORAGE_KEY = 'golden_palace_lang';
const LANG_MANUAL_KEY = 'golden_palace_lang_manual';

const ROLE_LABELS: Record<string, { ar: string; fr: string }> = {
  ADMIN: { ar: 'المدير العام', fr: 'Administrateur' },
  MANAGER: { ar: 'مدير الصالة', fr: 'Gérant' },
  CASHIER: { ar: 'كاشير', fr: 'Caissier' },
  WAITER: { ar: 'نادل', fr: 'Serveur' },
  KITCHEN: { ar: 'شيف المطبخ', fr: 'Cuisine' },
  INVENTORY: { ar: 'مسؤول المخزون', fr: 'Stock' },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<AppLanguage>(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      return saved === 'fr' ? 'fr' : 'ar';
    } catch {
      return 'ar';
    }
  });

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }, [lang]);

  const setLang = (next: AppLanguage) => {
    try {
      localStorage.setItem(LANG_MANUAL_KEY, 'true');
    } catch {
      // ignore
    }
    setLangState(next);
  };

  const toggleLang = () => {
    try {
      localStorage.setItem(LANG_MANUAL_KEY, 'true');
    } catch {
      // ignore
    }
    setLangState((prev) => (prev === 'ar' ? 'fr' : 'ar'));
  };

  const applyDefaultLanguage = (defaultLang?: string | null) => {
    if (defaultLang !== 'ar' && defaultLang !== 'fr') return;
    try {
      const manual = localStorage.getItem(LANG_MANUAL_KEY) === 'true';
      if (manual) return;
    } catch {
      // ignore
    }
    setLangState(defaultLang);
  };

  const t = (ar: string, fr: string) => (lang === 'ar' ? ar : fr);
  const roleLabel = (role?: Role | string | null) => {
    if (!role) return '';
    const entry = ROLE_LABELS[String(role).toUpperCase()];
    if (!entry) return String(role);
    return lang === 'ar' ? entry.ar : entry.fr;
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        isRtl: lang === 'ar',
        setLang,
        toggleLang,
        applyDefaultLanguage,
        t,
        roleLabel,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

const defaultFallbackRoleLabel = (role?: Role | string | null) => {
  if (!role) return '';
  const entry = ROLE_LABELS[String(role).toUpperCase()];
  return entry ? entry.ar : String(role);
};

export const useLanguage = (): LanguageContextType => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: 'ar',
      isRtl: true,
      setLang: () => {},
      toggleLang: () => {},
      applyDefaultLanguage: () => {},
      t: (ar: string) => ar,
      roleLabel: defaultFallbackRoleLabel,
    };
  }
  return ctx;
};
