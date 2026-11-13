/// <reference path="./env.d.ts" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import "./styles.css";
import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import { App } from "./App.tsx";
import { i18n } from "../../i18n/index.ts";

const container = document.getElementById("root");

if (!container) {
    throw new Error("Missing #root element");
}

const config = await window.jarvix?.getConfig().catch(() => null);
await i18n.changeLanguage(config?.language ?? (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"));

i18n.on("languageChanged", (language) => {
    document.documentElement.lang = language;
});
document.documentElement.lang = i18n.language;

createRoot(container).render(
    <StrictMode>
        <I18nextProvider i18n={i18n}>
            <App />
        </I18nextProvider>
    </StrictMode>
);
