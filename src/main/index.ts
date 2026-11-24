import { app } from "electron";
import { join } from "node:path";
import { Jarvix } from "../core/index.ts";
import { createPiAdapter } from "../llm/pi.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import { attachEventBridge } from "./event-bridge.ts";
import { registerIpc } from "./ipc.ts";
import { initializeLogging, logFilePath, mainLogger } from "./logger.ts";
import {
    createSqliteAgentObserver,
    observabilityDatabasePath
} from "./observability/index.ts";
import { configPaths, loadConfig, parseConfig, saveConfig, systemDefaults } from "./services/config.ts";
import { ModelCatalogService } from "./services/model-catalog.ts";
import { SandboxSetupService } from "./services/sandbox-setup.ts";
import { MainWindowController } from "./window.ts";

initializeLogging();
const log = mainLogger("main");

if (!app.requestSingleInstanceLock()) {
    log.warn("Another Jarvix instance is already running; quitting", {
        pid: process.pid
    });
    app.quit();
} else {
    const windows = new MainWindowController();
    log.info("Jarvix starting", {
        version: app.getVersion(),
        electron: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        logFile: logFilePath()
    });

    app.on("second-instance", (_event, commandLine) => {
        log.info("Second instance requested focus", {
            argumentCount: commandLine.length
        });
        if (app.isReady()) {
            windows.focus();
        } else {
            void app.whenReady().then(() => windows.focus());
        }
    });

    app.whenReady().then(() => {
        const paths = configPaths();
        const defaults = systemDefaults(app.getLocale());
        log.info("Application ready", {
            configDirectory: paths.directory,
            locale: app.getLocale()
        });

        let config = loadConfig(paths, defaults, mainLogger("config"));
        log.info("Configuration loaded", configDetails(config));
        const sandboxSetup = new SandboxSetupService({
            notifyRequired: () => windows.send(IPC_CHANNELS.sandboxSetupRequired, {}),
            windowAvailable: () => windows.current !== null,
            logger: mainLogger("sandbox")
        });
        const observer = createSqliteAgentObserver({
            databasePath: observabilityDatabasePath(),
            appVersion: app.getVersion(),
            buildId: process.env.JARVIX_BUILD_ID
                ?? (app.isPackaged ? app.getVersion() : "dev"),
            logger: mainLogger("observability")
        });
        const jarvix = new Jarvix({
            llm: createPiAdapter({ providers: () => config.providers }),
            config,
            sandboxPreflight: () => sandboxSetup.preflight(),
            logger: mainLogger("core"),
            observer
        });
        const catalog = new ModelCatalogService(
            join(paths.directory, "tmp", "models-dev.json"),
            fetch,
            mainLogger("catalog")
        );

        const updateConfig = (payload: unknown): typeof config => {
            const next = parseConfig(payload, defaults);
            saveConfig(next, paths, defaults);
            config = next;
            jarvix.setConfig(next);
            windows.applyTheme(next.theme);
            log.info("Configuration updated", configDetails(next));
            return next;
        };

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

        app.on("activate", () => {
            log.info("Application activate event received");
            windows.ensureOpen();
        });

        let shutdownStarted = false;
        let shutdownComplete = false;
        app.on("before-quit", (event) => {
            if (shutdownComplete) {
                log.debug("Application shutdown complete; allowing quit");
                return;
            }
            event.preventDefault();
            if (shutdownStarted) {
                log.debug("Application shutdown already in progress");
                return;
            }
            shutdownStarted = true;
            log.info("Application shutdown started");
            void jarvix.shutdown()
                .catch((error: unknown) => {
                    log.error("Failed to shut down sessions and tools", error);
                })
                .then(() => observer.flush(1_000))
                .catch((error: unknown) => {
                    log.error("Failed to flush Agent observability data", error);
                })
                .finally(() => {
                    log.info("Agent observability closed", observer.stats());
                    observer.close();
                    shutdownComplete = true;
                    log.info("Application shutdown finished");
                    app.quit();
                });
        });
    }).catch((error: unknown) => {
        log.error("Failed to start Jarvix", error);
        app.quit();
    });

    app.on("window-all-closed", () => {
        log.info("All windows closed", { platform: process.platform });
        if (process.platform !== "darwin") {
            app.quit();
        }
    });
}

function configDetails(config: JarvixConfig): Record<string, unknown> {
    return {
        providerCount: config.providers?.length ?? 0,
        selectedModel: config.selectedModel
            ? `${config.selectedModel.provider}/${config.selectedModel.id}`
            : null,
        reasoning: config.reasoning,
        language: config.language,
        theme: config.theme,
        contextCompactionThreshold: config.contextCompactionThreshold
    };
}
