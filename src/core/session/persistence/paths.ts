import { homedir } from "node:os";
import { join } from "node:path";
import { assertStorageId } from "../../storage-id.ts";

export const SESSION_FILE_EXTENSION = ".jsonl";
export const SESSION_META_FILE_EXTENSION = ".meta.json";

export function defaultSessionDirectory(): string {
    return join(homedir(), ".jarvix", "sessions");
}

export function defaultVerifierDirectory(): string {
    return join(defaultSessionDirectory(), "verifier");
}

/** Path of the `.jsonl` file backing the session with `id`. */
export function sessionFile(
    id: string,
    directory = defaultSessionDirectory()
): string {
    return join(
        directory,
        `${assertStorageId(id, "session")}${SESSION_FILE_EXTENSION}`
    );
}

/** Path of the sidecar metadata file for a session data file. */
export function sessionMetaFileFor(sessionDataFile: string): string {
    return sessionDataFile.endsWith(SESSION_FILE_EXTENSION)
        ? `${sessionDataFile.slice(0, -SESSION_FILE_EXTENSION.length)}${SESSION_META_FILE_EXTENSION}`
        : `${sessionDataFile}${SESSION_META_FILE_EXTENSION}`;
}

/** Path of one goal-verifier transcript. */
export function verifierFile(
    id: string,
    directory = defaultVerifierDirectory()
): string {
    return join(
        directory,
        `${assertStorageId(id, "verifier")}${SESSION_FILE_EXTENSION}`
    );
}
