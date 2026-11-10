/// <reference path="./env.d.ts" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import { App } from "./App.tsx";
import { i18n } from "./i18n/index.ts";

const container = document.getElementById("root");

if (!container) {
    throw new Error("Missing #root element");
}

const config = await window.jarvix?.getConfig().catch(() => null);
if (config?.language) {
    await i18n.changeLanguage(config.language);
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);
