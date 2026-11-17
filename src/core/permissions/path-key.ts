import { resolve } from "node:path";

/** Returns the platform-comparable key for a permission path. */
export function permissionPathKey(path: string): string {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
