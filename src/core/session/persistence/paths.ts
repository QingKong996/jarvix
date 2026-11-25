import { homedir } from "node:os";
import { join } from "node:path";
import { assertStorageId } from "../../storage-id.ts";

export const SESSION_FILE_EXTENSION = ".jsonl";

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
