import { dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { isAbsolute } from "node:path";
import type { Jarvix } from "../core/index.ts";
import { assertStorageId } from "../core/storage-id.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import { pathCompletionQuerySchema } from "../protocol/path-completion.ts";
import {
    DEFAULT_PERMISSION_MODE,
    permissionModeSchema,
    sandboxPathsSchema,
    type PermissionMode
} from "../protocol/permission.ts";
import { createProjectInputSchema } from "../protocol/project.ts";
import {
    sessionGoalContentSchema,
    sessionContextSchema,
    sessionNameSchema,
    type JarvixSessionContext
} from "../protocol/session.ts";
import { mainLogger } from "./logger.ts";
import type { ModelCatalogService } from "./services/model-catalog.ts";
import { syncProviderModels } from "./services/provider-model-sync.ts";
import { completePaths } from "./services/path-completion.ts";
import type { SandboxSetupService } from "./services/sandbox-setup.ts";
import type { MainWindowController } from "./window.ts";

const SLOW_IPC_MS = 1_000;
const log = mainLogger("ipc");
const providerLog = mainLogger("provider");

export type IpcDependencies = {
    jarvix: Jarvix;
    windows: MainWindowController;
    catalog: ModelCatalogService;
    sandboxSetup: SandboxSetupService;
    getConfig(): JarvixConfig;
    updateConfig(payload: unknown): JarvixConfig;
};

type IpcHandler = (
    event: IpcMainInvokeEvent,
    ...args: unknown[]
) => unknown;

function handle(channel: string, handler: IpcHandler): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        const startedAt = performance.now();
        const details = {
            channel,
            webContentsId: event.sender.id
        };
        log.debug("IPC handler started", details);
        try {
            const result = await handler(event, ...args);
            const durationMs = elapsedMs(startedAt);
            if (durationMs >= SLOW_IPC_MS) {
                log.warn("IPC handler completed slowly", { ...details, durationMs });
            } else {
                log.debug("IPC handler completed", { ...details, durationMs });
            }
            return result;
        } catch (error) {
            log.error("IPC handler failed", error, {
                ...details,
                durationMs: elapsedMs(startedAt)
            });
            throw error;
        }
    });
}

function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}

function requirePayload(value: unknown, message: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new Error(message);
    }
    return value as Record<string, unknown>;
}

function requireSessionId(value: unknown): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("Session id must be a non-empty string");
    }
    return assertStorageId(value, "session");
}

function parseSessionContext(value: unknown): JarvixSessionContext {
    const parsed = sessionContextSchema.safeParse(value ?? {});
    if (!parsed.success) {
        throw new Error("Invalid session context");
    }
    return parsed.data;
}

function parseSessionName(value: unknown): string {
    const parsed = sessionNameSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error("Invalid session name");
    }
    return parsed.data;
}

function parsePermissionMode(value: unknown): PermissionMode {
    const parsed = permissionModeSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error("Invalid permission mode");
    }
    return parsed.data;
}

function parseSandboxPaths(value: unknown): string[] {
    const parsed = sandboxPathsSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error("Invalid sandbox paths");
    }
    const unique = [...new Set(parsed.data)];
    if (unique.some((path) => !isAbsolute(path))) {
        throw new Error("Sandbox paths must be absolute");
    }
    return unique;
}

export function registerIpc(dependencies: IpcDependencies): void {
    const { jarvix, windows, catalog, sandboxSetup, getConfig, updateConfig } = dependencies;
    const assertSender = (event: IpcMainInvokeEvent): void => windows.assertSender(event);

    handle(IPC_CHANNELS.request, async (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid request payload");
        const { question, sessionId } = request;
        if (typeof question !== "string") {
            throw new Error("Question must be a string");
        }
        return jarvix.request(
            question,
            requireSessionId(sessionId),
            parseSandboxPaths(request.sandboxPaths)
        );
    });

    handle(IPC_CHANNELS.requestStop, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.stopRequest(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.requestInject, (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid request payload");
        const { question, sessionId, promptId } = request;
        if (typeof question !== "string" || question.trim().length === 0) {
            throw new Error("Question must be a non-empty string");
        }
        if (typeof promptId !== "string" || promptId.trim().length === 0) {
            throw new Error("Prompt id must be a non-empty string");
        }
        return jarvix.injectPrompt(
            question,
            requireSessionId(sessionId),
            promptId,
            parseSandboxPaths(request.sandboxPaths)
        );
    });

    handle(IPC_CHANNELS.pathsComplete, async (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid path completion payload");
        const query = pathCompletionQuerySchema.safeParse(request.query);
        if (!query.success) {
            throw new Error("Invalid path completion query");
        }
        return completePaths(
            query.data,
            parseSessionContext(request.context)
        );
    });

    handle(IPC_CHANNELS.configGet, (event) => {
        assertSender(event);
        return getConfig();
    });

    handle(IPC_CHANNELS.catalogGet, (event, force: unknown) => {
        assertSender(event);
        return catalog.get(force === true);
    });

    handle(IPC_CHANNELS.providerModelsSync, (event, provider: unknown) => {
        assertSender(event);
        return syncProviderModels(provider, fetch, providerLog);
    });

    handle(IPC_CHANNELS.configSet, (event, payload: unknown) => {
        assertSender(event);
        return updateConfig(payload);
    });

    handle(IPC_CHANNELS.projectCreate, (event, payload: unknown) => {
        assertSender(event);
        const parsed = createProjectInputSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error("Invalid project payload");
        }
        return jarvix.createProject(parsed.data.name, parsed.data.workingDirectories);
    });

    handle(IPC_CHANNELS.projectsList, (event) => {
        assertSender(event);
        return jarvix.listProjects();
    });

    handle(IPC_CHANNELS.pickWorkingDirectories, async (event) => {
        assertSender(event);
        const window = windows.current;
        if (!window) {
            return [];
        }
        const result = await dialog.showOpenDialog(window, {
            properties: ["openDirectory", "multiSelections"]
        });
        return result.canceled ? [] : result.filePaths;
    });

    handle(IPC_CHANNELS.pickWorkingDirectory, async (event) => {
        assertSender(event);
        const window = windows.current;
        if (!window) {
            return null;
        }
        const result = await dialog.showOpenDialog(window, {
            properties: ["openDirectory"]
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    });

    handle(IPC_CHANNELS.sessionCreate, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session payload");
        return jarvix.createSession(
            parseSessionContext(session.context),
            undefined,
            session.permission === undefined
                ? DEFAULT_PERMISSION_MODE
                : parsePermissionMode(session.permission)
        );
    });

    handle(IPC_CHANNELS.permissionSet, (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid permission payload");
        return jarvix.setPermission(
            requireSessionId(request.sessionId),
            parsePermissionMode(request.permission)
        );
    });

    handle(IPC_CHANNELS.permissionRespond, (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid permission response payload");
        const { requestId, approved } = request;
        if (typeof requestId !== "string" || requestId.length === 0) {
            throw new Error("Permission request id must be a non-empty string");
        }
        if (typeof approved !== "boolean") {
            throw new Error("Permission response must be a boolean");
        }
        return jarvix.respondPermission(
            requireSessionId(request.sessionId),
            requestId,
            approved
        );
    });

    handle(IPC_CHANNELS.sessionUpdateContext, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session context payload");
        return jarvix.updateSessionContext(
            requireSessionId(session.sessionId),
            parseSessionContext(session.context)
        );
    });

    handle(IPC_CHANNELS.sessionRename, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session rename payload");
        return jarvix.renameSession(
            requireSessionId(session.sessionId),
            parseSessionName(session.name)
        );
    });

    handle(IPC_CHANNELS.sessionAutoName, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session auto-name payload");
        const { sessionId, firstPrompt } = session;
        if (firstPrompt !== undefined && typeof firstPrompt !== "string") {
            throw new Error("Invalid first prompt");
        }
        return jarvix.autoNameSession(requireSessionId(sessionId), firstPrompt);
    });

    handle(IPC_CHANNELS.sessionArchive, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.archiveSession(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionUnarchive, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.unarchiveSession(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionDelete, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.deleteSession(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionGoalSet, (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid goal payload");
        const content = sessionGoalContentSchema.safeParse(request.content);
        if (!content.success) {
            throw new Error("Invalid goal content");
        }
        return jarvix.setGoal(
            requireSessionId(request.sessionId),
            content.data
        );
    });

    handle(IPC_CHANNELS.sessionGoalClear, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.clearGoal(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionOpen, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.loadSession(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionRelease, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.releaseSession(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionProviderContext, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.getProviderContext(requireSessionId(sessionId));
    });

    handle(IPC_CHANNELS.sessionsList, (event) => {
        assertSender(event);
        return jarvix.listSessions();
    });

    handle(IPC_CHANNELS.sessionsListArchived, (event) => {
        assertSender(event);
        return jarvix.listArchivedSessions();
    });

    handle(IPC_CHANNELS.sandboxStatus, async (event) => {
        assertSender(event);
        return sandboxSetup.status();
    });

    handle(IPC_CHANNELS.sandboxInstall, async (event) => {
        assertSender(event);
        return sandboxSetup.install();
    });

    handle(IPC_CHANNELS.sandboxDismiss, (event) => {
        assertSender(event);
        sandboxSetup.dismiss();
    });
}
