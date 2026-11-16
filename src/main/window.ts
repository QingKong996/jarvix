import { BrowserWindow, nativeTheme, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { DEFAULT_THEME, type Theme } from "../protocol/config.ts";

const WINDOW_BACKGROUND: Record<Theme, string> = {
    dark: "#0d1117",
    light: "#ffffff"
};

function activeTheme(theme: Theme | undefined): Theme {
    return theme ?? DEFAULT_THEME;
}

function isExternalUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
}

export class MainWindowController {
    private window: BrowserWindow | null = null;
    private theme: Theme = DEFAULT_THEME;

    get current(): BrowserWindow | null {
        if (!this.window || this.window.isDestroyed()) {
            return null;
        }
        return this.window;
    }

    applyTheme(theme: Theme | undefined): void {
        this.theme = activeTheme(theme);
        nativeTheme.themeSource = this.theme;
        const window = this.current;
        if (window) {
            window.setBackgroundColor(WINDOW_BACKGROUND[this.theme]);
        }
    }

    ensureOpen(): void {
        if (BrowserWindow.getAllWindows().length === 0) {
            this.open();
        }
    }

    assertSender(event: IpcMainInvokeEvent): void {
        if (event.sender !== this.current?.webContents) {
            throw new Error("Unexpected IPC sender");
        }
    }

    send(channel: string, payload: unknown): void {
        this.current?.webContents.send(channel, payload);
    }

    private open(): BrowserWindow {
        const window = new BrowserWindow({
            width: 1080,
            height: 720,
            minWidth: 760,
            minHeight: 520,
            backgroundColor: WINDOW_BACKGROUND[this.theme],
            autoHideMenuBar: true,
            webPreferences: {
                preload: join(import.meta.dirname, "../preload/index.cjs"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });

        this.window = window;
        window.on("closed", () => {
            if (this.window === window) {
                this.window = null;
            }
        });

        window.webContents.setWindowOpenHandler(({ url }) => {
            if (isExternalUrl(url)) {
                void shell.openExternal(url);
            }
            return { action: "deny" };
        });

        window.webContents.on("will-navigate", (event, url) => {
            event.preventDefault();
            if (isExternalUrl(url)) {
                void shell.openExternal(url);
            }
        });

        const rendererUrl = process.env.ELECTRON_RENDERER_URL;
        if (rendererUrl) {
            void window.loadURL(rendererUrl);
        } else {
            void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
        }

        return window;
    }
}
