const INVALID_STORAGE_ID_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const STORAGE_ID_MAX_LENGTH = 200;

/** Validate an identifier before using it as a file name. */
export function assertStorageId(id: string, kind: string): string {
    if (!isStorageId(id)) {
        throw new Error(`Invalid ${kind} id: ${JSON.stringify(id)}`);
    }
    return id;
}

export function isStorageId(id: string): boolean {
    return (
        id.length > 0 &&
        id.length <= STORAGE_ID_MAX_LENGTH &&
        id === id.trim() &&
        id !== "." &&
        id !== ".." &&
        !INVALID_STORAGE_ID_CHARACTERS.test(id) &&
        !WINDOWS_RESERVED_NAME.test(id)
    );
}
