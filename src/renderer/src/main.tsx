/// <reference path="./env.d.ts" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import { App } from "./App.tsx";

const container = document.getElementById("root");

if (!container) {
    throw new Error("Missing #root element");
}

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
);
