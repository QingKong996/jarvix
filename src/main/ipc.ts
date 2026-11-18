import { dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { Jarvix } from "../core/index.ts";
import { assertStorageId } from "../core/storage-id.ts";
import type { JarvixConfig } from "../protocol/config.ts";
import { IPC_CHANNELS } from "../protocol/ipc.ts";
import {
    DEFAULT_PERMISSION_MODE,
    permissionModeSchema,
    type PermissionMode
} from "../protocol/permission.ts";
import { createProjectInputSchema } from "../protocol/project.ts";
import {
    sessionContextSchema,
    sessionNameSchema,
    type JarvixSessionContext
} from "../protocol/session.ts";
import type { ModelCatalogService } from "./services/model-catalog.ts";
import { syncProviderModels } from "./services/provider-model-sync.ts";
import type { SandboxSetupService } from "./services/sandbox-setup.ts";
import type { MainWindowController } from "./window.ts";

export type IpcDependencies = {
    jarvix: Jarvix;
    windows: MainWindowController;
    catalog: ModelCatalogService;
    sandboxSetup: SandboxSetupService;
    getConfig(): JarvixConfig;
    updateConfig(payload: unknown): JarvixConfig;
};

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

export function registerIpc(dependencies: IpcDependencies): void {
    const { jarvix, windows, catalog, sandboxSetup, getConfig, updateConfig } = dependencies;
    const assertSender = (event: IpcMainInvokeEvent): void => windows.assertSender(event);

    ipcMain.handle(IPC_CHANNELS.request, async (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid request payload");
        const { question, sessionId } = request;
        if (typeof question !== "string" || question.trim().length === 0) {
            throw new Error("Question must be a non-empty string");
        }
        return jarvix.request(question, requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.requestStop, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.stopRequest(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.requestInject, (event, payload: unknown) => {
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
            promptId
        );
    });

    ipcMain.handle(IPC_CHANNELS.configGet, (event) => {
        assertSender(event);
        return getConfig();
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
        return updateConfig(payload);
    });

    ipcMain.handle(IPC_CHANNELS.projectCreate, (event, payload: unknown) => {
        assertSender(event);
        const parsed = createProjectInputSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error("Invalid project payload");
        }
        return jarvix.createProject(parsed.data.name, parsed.data.workingDirectories);
    });

    ipcMain.handle(IPC_CHANNELS.projectsList, (event) => {
        assertSender(event);
        return jarvix.listProjects();
    });

    ipcMain.handle(IPC_CHANNELS.pickWorkingDirectories, async (event) => {
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

    ipcMain.handle(IPC_CHANNELS.pickWorkingDirectory, async (event) => {
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

    ipcMain.handle(IPC_CHANNELS.sessionCreate, (event, payload: unknown) => {
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

    ipcMain.handle(IPC_CHANNELS.permissionSet, (event, payload: unknown) => {
        assertSender(event);
        const request = requirePayload(payload, "Invalid permission payload");
        return jarvix.setPermission(
            requireSessionId(request.sessionId),
            parsePermissionMode(request.permission)
        );
    });

    ipcMain.handle(IPC_CHANNELS.permissionRespond, (event, payload: unknown) => {
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

    ipcMain.handle(IPC_CHANNELS.sessionUpdateContext, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session context payload");
        return jarvix.updateSessionContext(
            requireSessionId(session.sessionId),
            parseSessionContext(session.context)
        );
    });

    ipcMain.handle(IPC_CHANNELS.sessionRename, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session rename payload");
        return jarvix.renameSession(
            requireSessionId(session.sessionId),
            parseSessionName(session.name)
        );
    });

    ipcMain.handle(IPC_CHANNELS.sessionAutoName, (event, payload: unknown) => {
        assertSender(event);
        const session = requirePayload(payload, "Invalid session auto-name payload");
        const { sessionId, firstPrompt } = session;
        if (firstPrompt !== undefined && typeof firstPrompt !== "string") {
            throw new Error("Invalid first prompt");
        }
        return jarvix.autoNameSession(requireSessionId(sessionId), firstPrompt);
    });

    ipcMain.handle(IPC_CHANNELS.sessionArchive, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.archiveSession(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionUnarchive, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.unarchiveSession(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionDelete, (event, sessionId: unknown) => {
        assertSender(event);
        jarvix.deleteSession(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionOpen, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.loadSession(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionRelease, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.releaseSession(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionProviderContext, (event, sessionId: unknown) => {
        assertSender(event);
        return jarvix.getProviderContext(requireSessionId(sessionId));
    });

    ipcMain.handle(IPC_CHANNELS.sessionsList, (event) => {
        assertSender(event);
        return jarvix.listSessions();
    });

    ipcMain.handle(IPC_CHANNELS.sessionsListArchived, (event) => {
        assertSender(event);
        return jarvix.listArchivedSessions();
    });

    ipcMain.handle(IPC_CHANNELS.sandboxStatus, async (event) => {
        assertSender(event);
        return sandboxSetup.status();
    });

    ipcMain.handle(IPC_CHANNELS.sandboxInstall, async (event) => {
        assertSender(event);
        return sandboxSetup.install();
    });

    ipcMain.handle(IPC_CHANNELS.sandboxDismiss, (event) => {
        assertSender(event);
        sandboxSetup.dismiss();
    });
}
