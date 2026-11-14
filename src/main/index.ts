import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Jarvix } from "../core/index.ts";
import { DEFAULT_THEME, type JarvixConfig, type Theme } from "../protocol/config.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import { IPC_CHANNELS, type JarvixEventBatch } from "../protocol/ipc.ts";
import { configPaths, loadConfig, parseConfig, saveConfig, systemDefaults } from "./config.ts";
import { createStreamBatcher } from "./stream-batcher.ts";
import { ModelCatalogService } from "./model-catalog.ts";
import { syncProviderModels } from "./provider-model-sync.ts";

let config: JarvixConfig = {};
const jarvix = new Jarvix();
const paths = configPaths();
const catalog = new ModelCatalogService(join(paths.directory, "tmp", "models-dev.json"));
const legacyCatalogFile = join(paths.directory, "models-dev.json");

let mainWindow: BrowserWindow | null = null;

const WINDOW_BACKGROUND: Record<Theme, string> = {
    dark: "#0b0e14",
    light: "#ffffff"
};

function activeTheme(theme: Theme | undefined): Theme {
    return theme ?? DEFAULT_THEME;
}

function applyTheme(theme: Theme | undefined): void {
    const resolved = activeTheme(theme);
    nativeTheme.themeSource = resolved;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(WINDOW_BACKGROUND[resolved]);
    }
}

function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 760,
        minHeight: 520,
        backgroundColor: WINDOW_BACKGROUND[activeTheme(config.theme)],
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(import.meta.dirname, "../preload/index.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    window.on("closed", () => {
        if (mainWindow === window) {
            mainWindow = null;
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

function assertSender(event: IpcMainInvokeEvent): void {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error("Unexpected IPC sender");
    }
}

function isExternalUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
}

function requireSessionId(value: unknown): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("Session id must be a non-empty string");
    }
    return value;
}

function sendEvents(sessionId: string, events: JarvixEvent[]): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const batch: JarvixEventBatch = { sessionId, events };
        mainWindow.webContents.send(IPC_CHANNELS.event, batch);
    }
}

const batchers = new Map<string, ReturnType<typeof createStreamBatcher>>();

jarvix.subscribe((event, sessionId) => {
    let batcher = batchers.get(sessionId);
    if (!batcher) {
        batcher = createStreamBatcher((events) => sendEvents(sessionId, events));
        batchers.set(sessionId, batcher);
    }
    batcher.push(event);
});

ipcMain.handle(IPC_CHANNELS.request, async (event, payload: unknown) => {
    assertSender(event);
    if (typeof payload !== "object" || payload === null) {
        throw new Error("Invalid request payload");
    }

    const { question, sessionId } = payload as Record<string, unknown>;
    if (typeof question !== "string" || question.trim().length === 0) {
        throw new Error("Question must be a non-empty string");
    }
    return jarvix.request(question, requireSessionId(sessionId));
});

ipcMain.handle(IPC_CHANNELS.configGet, (event) => {
    assertSender(event);
    return config;
});

ipcMain.handle(IPC_CHANNELS.catalogGet, (event, force: unknown) => {
    assertSender(event);
    return catalog.get(force === true);
});

ipcMain.handle(IPC_CHANNELS.providerModelsSync, (event, provider: unknown) => {
    assertSender(event);
    return syncProviderModels(provider);
});

ipcMain.handle(IPC_CHANNELS.configSet, (event, payload: unknown) => {
    assertSender(event);
    const next = parseConfig(payload, systemDefaults(app.getLocale()));
    saveConfig(next);
    config = next;
    jarvix.setConfig(config);
    applyTheme(config.theme);
    return config;
});

ipcMain.handle(IPC_CHANNELS.sessionCreate, (event) => {
    assertSender(event);
    return jarvix.createSession();
});

ipcMain.handle(IPC_CHANNELS.sessionOpen, (event, sessionId: unknown) => {
    assertSender(event);
    return jarvix.loadSession(requireSessionId(sessionId));
});

ipcMain.handle(IPC_CHANNELS.sessionsList, (event) => {
    assertSender(event);
    return jarvix.listSessions();
});

app.whenReady().then(() => {
    void rm(legacyCatalogFile, { force: true }).catch(() => undefined);
    config = loadConfig(paths, systemDefaults(app.getLocale()));
    jarvix.setConfig(config);
    applyTheme(config.theme);
    mainWindow = createMainWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
