import { BrowserWindow, nativeTheme, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { DEFAULT_THEME, type Theme } from "../protocol/config.ts";
import { mainLogger } from "./logger.ts";

const WINDOW_BACKGROUND: Record<Theme, string> = {
    dark: "#0d1117",
    light: "#ffffff"
};
const log = mainLogger("window");

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
        log.debug("Applied window theme", { theme: this.theme, windowId: window?.id });
    }

    ensureOpen(): void {
        if (BrowserWindow.getAllWindows().length === 0) {
            this.open();
        }
    }

    focus(): void {
        const window = this.current;
        if (!window) {
            log.info("Focus requested without an open window");
            this.ensureOpen();
            return;
        }
        if (window.isMinimized()) {
            window.restore();
        }
        window.show();
        window.focus();
        log.debug("Focused main window", { windowId: window.id });
    }

    assertSender(event: IpcMainInvokeEvent): void {
        if (event.sender !== this.current?.webContents) {
            log.warn("Rejected IPC from an unexpected sender", {
                senderId: event.sender.id
            });
            throw new Error("Unexpected IPC sender");
        }
    }

    send(channel: string, payload: unknown): void {
        this.current?.webContents.send(channel, payload);
    }

    private open(): BrowserWindow {
        log.info("Creating main window", { theme: this.theme });
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
        window.once("ready-to-show", () => {
            log.info("Main window is ready to show", { windowId: window.id });
        });
        window.on("closed", () => {
            log.info("Main window closed", { windowId: window.id });
            if (this.window === window) {
                this.window = null;
            }
        });
        window.webContents.on("did-finish-load", () => {
            log.info("Renderer finished loading", {
                windowId: window.id,
                url: window.webContents.getURL()
            });
        });

        window.webContents.setWindowOpenHandler(({ url }) => {
            if (isExternalUrl(url)) {
                log.info("Opening external URL in the system browser", { url });
                void shell.openExternal(url).catch((error: unknown) => {
                    log.error("Failed to open external URL", error, { url });
                });
            } else {
                log.warn("Blocked non-HTTP window.open request", { url });
            }
            return { action: "deny" };
        });

        window.webContents.on("will-navigate", (event, url) => {
            event.preventDefault();
            if (isExternalUrl(url)) {
                log.info("Redirecting navigation to the system browser", { url });
                void shell.openExternal(url).catch((error: unknown) => {
                    log.error("Failed to open external URL", error, { url });
                });
            } else {
                log.warn("Blocked navigation", { url });
            }
        });

        const rendererUrl = process.env.ELECTRON_RENDERER_URL;
        const load = rendererUrl
            ? window.loadURL(rendererUrl)
            : window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
        void load.catch((error: unknown) => {
            log.error("Failed to load renderer", error, {
                rendererUrl: rendererUrl ?? null
            });
        });

        return window;
    }
}
