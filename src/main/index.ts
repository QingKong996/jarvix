import { app } from "electron";
import { join } from "node:path";
import { Jarvix } from "../core/index.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import { attachEventBridge } from "./event-bridge.ts";
import { registerIpc } from "./ipc.ts";
import { configPaths, loadConfig, parseConfig, saveConfig, systemDefaults } from "./services/config.ts";
import { ModelCatalogService } from "./services/model-catalog.ts";
import { SandboxSetupService } from "./services/sandbox-setup.ts";
import { MainWindowController } from "./window.ts";

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    const windows = new MainWindowController();

    app.on("second-instance", () => {
        if (app.isReady()) {
            windows.focus();
        } else {
            void app.whenReady().then(() => windows.focus());
        }
    });

    app.whenReady().then(() => {
        const paths = configPaths();
        const defaults = systemDefaults(app.getLocale());

        let config = loadConfig(paths, defaults);
        const sandboxSetup = new SandboxSetupService({
            notifyRequired: () => windows.send(IPC_CHANNELS.sandboxSetupRequired, {}),
            windowAvailable: () => windows.current !== null
        });
        const jarvix = new Jarvix({
            sandboxPreflight: () => sandboxSetup.preflight()
        });
        const catalog = new ModelCatalogService(join(paths.directory, "tmp", "models-dev.json"));

        const updateConfig = (payload: unknown): typeof config => {
            const next = parseConfig(payload, defaults);
            saveConfig(next, paths, defaults);
            config = next;
            jarvix.setConfig(next);
            windows.applyTheme(next.theme);
            return next;
        };

        jarvix.setConfig(config);
        windows.applyTheme(config.theme);
        attachEventBridge(jarvix, windows);
        registerIpc({
            jarvix,
            windows,
            catalog,
            sandboxSetup,
            getConfig: () => config,
            updateConfig
        });
        windows.ensureOpen();

        app.on("activate", () => windows.ensureOpen());

        let shutdownStarted = false;
        let shutdownComplete = false;
        app.on("before-quit", (event) => {
            if (shutdownComplete) {
                return;
            }
            event.preventDefault();
            if (shutdownStarted) {
                return;
            }
            shutdownStarted = true;
            void jarvix.shutdown()
                .catch((error: unknown) => {
                    console.error("Failed to shut down tools cleanly.", error);
                })
                .finally(() => {
                    shutdownComplete = true;
                    app.quit();
                });
        });
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });
}
