import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import pt from "./locales/pt.json";
import fr from "./locales/fr.json";
import en from "./locales/en.json";
import kri from "./locales/kri.json";

const STORAGE_KEY = "bornaal_lang";
const SUPPORTED = ["pt", "fr", "en", "kri"] as const;
export type Lang = (typeof SUPPORTED)[number];

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    // localStorage pode estar bloqueado (modo privado, definicoes do browser).
    // Nao e erro: cai para portugues.
  }
  return "pt";
}

i18n.use(initReactI18next).init({
  resources: {
    pt: { translation: pt },
    fr: { translation: fr },
    en: { translation: en },
    kri: { translation: kri },
  },
  lng: getInitialLang(),
  fallbackLng: "pt",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Sem localStorage a escolha de idioma so dura a sessao. Nao ha o que fazer.
  }
});

export default i18n;
export { STORAGE_KEY, SUPPORTED };
