import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "../../../protocol/config.ts";
import { en } from "./locales/en.ts";
import { zh } from "./locales/zh.ts";

const resources = {
    zh: { translation: zh },
    en: { translation: en }
};

function detectLanguage(): Language {
    if (typeof navigator === "undefined") {
        return "zh";
    }
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

void i18next.use(initReactI18next).init({
    resources,
    lng: detectLanguage(),
    fallbackLng: "zh",
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false }
});

i18next.on("languageChanged", (language) => {
    if (typeof document !== "undefined") {
        document.documentElement.lang = language;
    }
});

if (typeof document !== "undefined") {
    document.documentElement.lang = i18next.language;
}

export { i18next as i18n };
