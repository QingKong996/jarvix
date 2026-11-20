import type { JarvixBridge } from "../../../protocol/ipc.ts";
import type { JarvixProject } from "../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";

export type SessionSnapshot = {
    projects: JarvixProject[];
    sessions: JarvixSessionSummary[];
    archivedSessions: JarvixSessionSummary[];
};

export async function loadSessionSnapshot(bridge: JarvixBridge): Promise<SessionSnapshot> {
    const [projects, sessions, archivedSessions] = await Promise.all([
        bridge.listProjects(),
        bridge.listSessions(),
        bridge.listArchivedSessions()
    ]);
    return { projects, sessions, archivedSessions };
}

export async function loadProjects(
    bridge: JarvixBridge | undefined
): Promise<JarvixProject[] | null> {
    if (!bridge) {
        return null;
    }
    try {
        return await bridge.listProjects();
    } catch {
        return null;
    }
}

export async function loadSessions(
    bridge: JarvixBridge | undefined
): Promise<JarvixSessionSummary[] | null> {
    if (!bridge) {
        return null;
    }
    try {
        return await bridge.listSessions();
    } catch {
        return null;
    }
}

export async function loadArchivedSessions(
    bridge: JarvixBridge | undefined
): Promise<JarvixSessionSummary[] | null> {
    if (!bridge) {
        return null;
    }
    try {
        return await bridge.listArchivedSessions();
    } catch {
        return null;
    }
}
