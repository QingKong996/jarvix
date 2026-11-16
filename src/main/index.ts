import { app } from "electron";
import { join } from "node:path";
import { Jarvix } from "../core/index.ts";
import { attachEventBridge } from "./event-bridge.ts";
import { registerIpc } from "./ipc.ts";
import { configPaths, loadConfig, parseConfig, saveConfig, systemDefaults } from "./services/config.ts";
import { ModelCatalogService } from "./services/model-catalog.ts";
import { MainWindowController } from "./window.ts";

app.whenReady().then(() => {
    const paths = configPaths();
    const defaults = systemDefaults(app.getLocale());

    let config = loadConfig(paths, defaults);
    const jarvix = new Jarvix();
    const windows = new MainWindowController();
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
        getConfig: () => config,
        updateConfig
    });
    windows.ensureOpen();

    app.on("activate", () => windows.ensureOpen());
    app.on("will-quit", () => jarvix.dispose());
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
