import type { JarvixSessionContext } from "../../protocol/session.ts";
import { loadProject } from "../project/store.ts";

type SessionLocation = Pick<JarvixSessionContext, "projectId" | "workingDirectory">;

/** Resolve the directories a session may use, preferring its project over a one-off directory. */
export function workingDirectoriesFor(location: SessionLocation): readonly string[] {
    const project = location.projectId ? loadProject(location.projectId) : null;
    return project?.workingDirectories
        ?? (location.workingDirectory ? [location.workingDirectory] : []);
}
