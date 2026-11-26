import { app } from "electron";
import { join } from "node:path";
import { Jarvix } from "../core/index.ts";
import { createPiAdapter } from "../llm/pi.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import { createToolSandboxFactory } from "../sandbox/index.ts";
import { attachEventBridge } from "./event-bridge.ts";
import {
    createHeadlessConfig,
    HEADLESS_HELP,
    parseHeadlessArguments,
    type HeadlessOptions
} from "./headless/options.ts";
import { runHeadless } from "./headless/run.ts";
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
import { SkillCatalog } from "../core/skills/skill-catalog.ts";

const log = mainLogger("main");

type HeadlessBootstrap =
    | { kind: "disabled" }
    | { kind: "help" }
    | { kind: "error"; message: string }
    | { kind: "run"; options: HeadlessOptions; config: JarvixConfig };

const headless = headlessBootstrap(
    process.argv.slice(process.defaultApp ? 2 : 1)
);
if (headless.kind === "error") {
    process.stderr.write(`jarvix: ${headless.message}\n`);
    app.exit(2);
} else if (headless.kind === "help") {
    process.stdout.write(HEADLESS_HELP);
    app.exit(0);
} else if (headless.kind === "run") {
    startHeadless(headless.options, headless.config);
} else {
    initializeLogging();
    startDesktop();
}

function headlessBootstrap(argv: readonly string[]): HeadlessBootstrap {
    try {
        const invocation = parseHeadlessArguments(argv);
        if (invocation.kind !== "run") {
            return invocation;
        }
        return {
            ...invocation,
            config: createHeadlessConfig(invocation.options)
        };
    } catch (error) {
        return {
            kind: "error",
            message: error instanceof Error ? error.message : String(error)
        };
    }
}

function startHeadless(options: HeadlessOptions, config: JarvixConfig): void {
    initializeLogging({ console: false });
    void app.whenReady()
        .then(async () => {
            if (process.platform === "darwin") {
                app.dock?.hide();
            }
            return runHeadless(options, config);
        })
        .then((code) => app.exit(code))
        .catch((error: unknown) => {
            process.stderr.write(
                `jarvix: ${error instanceof Error ? error.message : String(error)}\n`
            );
            app.exit(1);
        });
}

function startDesktop(): void {
    if (!app.requestSingleInstanceLock()) {
        log.warn("Another Jarvix instance is already running; quitting", {
            pid: process.pid
        });
        app.quit();
        return;
    }

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
        const sandboxFactory = createToolSandboxFactory({
            preflight: () => sandboxSetup.preflight()
        });
        const observer = createSqliteAgentObserver({
            databasePath: observabilityDatabasePath(),
            appVersion: app.getVersion(),
            buildId: process.env.JARVIX_BUILD_ID
                ?? (app.isPackaged ? app.getVersion() : "dev"),
            logger: mainLogger("observability")
        });
        const skillCatalog = new SkillCatalog({
            settings: () => config.skills ?? {}
        });
        const jarvix = new Jarvix({
            llm: createPiAdapter({ providers: () => config.providers }),
            config,
            sandboxFactory,
            logger: mainLogger("core"),
            observer,
            skillCatalog
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
