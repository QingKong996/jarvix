import i18next from "i18next";
import en from "./locales/en.json" with { type: "json" };
import zh from "./locales/zh.json" with { type: "json" };

export const i18n = i18next.createInstance();

void i18n.init({
    resources: {
        zh: { translation: zh },
        en: { translation: en }
    },
    lng: "zh",
    fallbackLng: "zh",
    initAsync: false,
    interpolation: { escapeValue: false }
});
