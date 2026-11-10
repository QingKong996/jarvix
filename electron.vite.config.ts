import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

function devCspPlugin(): Plugin {
    return {
        name: "jarvix:dev-csp",
        apply: "serve",
        transformIndexHtml(html) {
            return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';");
        }
    };
}

export default defineConfig({
    main: {},
    preload: {
        build: {
            rollupOptions: {
                output: {
                    format: "cjs"
                }
            }
        }
    },
    renderer: {
        build: {
            minify: true
        },
        plugins: [react(), tailwindcss(), devCspPlugin()],
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url))
            }
        },
        server: {
            host: "127.0.0.1"
        }
    }
});
