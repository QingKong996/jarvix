import { app } from "electron";
import electronLog from "electron-log/main";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JarvixLogger, LogDetails } from "../core/logger.ts";
import {
    archiveLogFile,
    LOG_RETENTION_DAYS,
    logFileName,
    pruneExpiredLogFiles
} from "./log-files.ts";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOG_DIRECTORY = join(homedir(), ".jarvix", "logs");

let initialized = false;
let cleanupTimer: NodeJS.Timeout | undefined;

export function initializeLogging(): void {
    if (initialized) {
        return;
    }
    initialized = true;

    const level = app.isPackaged ? "info" : "debug";
    electronLog.transports.file.level = level;
    electronLog.transports.console.level = level;
    electronLog.transports.file.maxSize = MAX_FILE_SIZE_BYTES;
    electronLog.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}";
    electronLog.transports.console.format = "{h}:{i}:{s}.{ms}{scope} › {level}: {text}";
    electronLog.transports.file.inspectOptions = { depth: 6 };
    electronLog.transports.file.resolvePathFn = (_variables, message) => join(
        LOG_DIRECTORY,
        logFileName(message?.date ?? new Date())
    );
    electronLog.transports.file.archiveLogFn = (file) => {
        try {
            archiveLogFile(file.path);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Failed to split oversized log ${file.path}: ${reason}\n`);
        }
    };

    electronLog.errorHandler.startCatching({ showDialog: false });
    electronLog.eventLogger.startLogging({
        level: "warn",
        scope: "electron",
        events: {
            app: {
                "certificate-error": true,
                "child-process-gone": true,
                "render-process-gone": true
            },
            webContents: {
                "console-message": true,
                "did-fail-load": true,
                "did-fail-provisional-load": true,
                "plugin-crashed": true,
                "preload-error": true,
                "unresponsive": true
            }
        }
    });
    scheduleLogCleanup();
}

export function logFilePath(): string {
    return electronLog.transports.file.getFile({ date: new Date() }).path;
}

export function mainLogger(scope: string): JarvixLogger {
    const scoped = electronLog.scope(scope);
    return {
        debug(message: string, details?: LogDetails): void {
            write(scoped.debug, message, details);
        },
        info(message: string, details?: LogDetails): void {
            write(scoped.info, message, details);
        },
        warn(message: string, details?: LogDetails): void {
            write(scoped.warn, message, details);
        },
        error(message: string, error?: unknown, details?: LogDetails): void {
            if (details !== undefined) {
                scoped.error(message, error, details);
            } else if (error !== undefined) {
                scoped.error(message, error);
            } else {
                scoped.error(message);
            }
        }
    };
}

function write(
    logger: (...params: unknown[]) => void,
    message: string,
    details?: LogDetails
): void {
    if (details === undefined) {
        logger(message);
    } else {
        logger(message, details);
    }
}

function scheduleLogCleanup(): void {
    if (cleanupTimer) {
        return;
    }
    const run = (): void => {
        const logger = mainLogger("logging");
        void pruneExpiredLogFiles(LOG_DIRECTORY)
            .then((deleted) => {
                if (deleted.length > 0) {
                    logger.info("Expired log files deleted", {
                        deletedCount: deleted.length,
                        retentionDays: LOG_RETENTION_DAYS
                    });
                }
            })
            .catch((error: unknown) => {
                logger.warn("Failed to clean up expired log files", {
                    reason: error instanceof Error ? error.message : String(error)
                });
            });
    };

    run();
    cleanupTimer = setInterval(run, LOG_CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
}
