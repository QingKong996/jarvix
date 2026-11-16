import type { JarvixProject } from "../../../../protocol/project.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";

export type SessionGroup = {
    key: string;
    project: JarvixProject | null;
    sessions: JarvixSessionSummary[];
    latestAt: number;
};

export function dropTargetId(projectId: string | null): string {
    return projectId ? `project:${projectId}` : "temporary";
}

export function projectGroups(
    projects: JarvixProject[],
    sessions: JarvixSessionSummary[]
): SessionGroup[] {
    const groups = new Map<string, SessionGroup>();
    for (const project of projects) {
        groups.set(project.id, {
            key: project.id,
            project,
            sessions: [],
            latestAt: project.createdAt
        });
    }

    const temporary: SessionGroup = {
        key: "temporary",
        project: null,
        sessions: [],
        latestAt: 0
    };

    for (const session of sessions) {
        const group = session.projectId ? groups.get(session.projectId) : undefined;
        (group ?? temporary).sessions.push(session);
    }

    if (temporary.sessions.length > 0) {
        groups.set(temporary.key, temporary);
    }

    return [...groups.values()]
        .map((group) => {
            const sortedSessions = [...group.sessions].sort(
                (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
            );
            return {
                ...group,
                sessions: sortedSessions,
                latestAt: sortedSessions[0]?.updatedAt ?? group.latestAt
            };
        })
        .sort((left, right) => {
            if (left.key === "temporary" || right.key === "temporary") {
                return left.key === "temporary" ? 1 : -1;
            }
            return right.latestAt - left.latestAt || left.key.localeCompare(right.key);
        });
}
