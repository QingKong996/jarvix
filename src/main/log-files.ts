import { existsSync, readdirSync, renameSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const LOG_RETENTION_DAYS = 90;

const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.(?:old|\d+))?\.log$/;
const BASE_LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

export function logFileName(date = new Date()): string {
    return `${localDateKey(date)}.log`;
}

export function archiveLogFile(filePath: string): string {
    const directory = dirname(filePath);
    const date = baseLogFileDate(basename(filePath));
    if (date === null) {
        throw new Error(`Unexpected log file name: ${basename(filePath)}`);
    }

    const existing = new Set(readdirSync(directory));
    for (let part = 1; ; part += 1) {
        const name = `${date}.${part}.log`;
        if (existing.has(name)) {
            continue;
        }

        const archivedPath = join(directory, name);
        try {
            renameSync(filePath, archivedPath);
            return archivedPath;
        } catch (error) {
            const code = errorCode(error);
            if ((code === "EEXIST" || code === "EPERM") && existsSync(archivedPath)) {
                existing.add(name);
                continue;
            }
            throw error;
        }
    }
}

export async function pruneExpiredLogFiles(
    directory: string,
    now = new Date(),
    retentionDays = LOG_RETENTION_DAYS
): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(directory);
    } catch (error) {
        if (errorCode(error) === "ENOENT") {
            return [];
        }
        throw error;
    }

    const cutoff = localDateKey(daysBefore(now, retentionDays));
    const expired = entries
        .filter((name) => {
            const date = logFileDate(name);
            return date !== null && date < cutoff;
        })
        .sort();
    const deleted: string[] = [];

    for (const name of expired) {
        try {
            await unlink(join(directory, name));
            deleted.push(name);
        } catch (error) {
            if (errorCode(error) !== "ENOENT") {
                throw error;
            }
        }
    }
    return deleted;
}

function logFileDate(name: string): string | null {
    const match = LOG_FILE_PATTERN.exec(name);
    if (!match?.[1] || !isValidDateKey(match[1])) {
        return null;
    }
    return match[1];
}

function baseLogFileDate(name: string): string | null {
    const match = BASE_LOG_FILE_PATTERN.exec(name);
    if (!match?.[1] || !isValidDateKey(match[1])) {
        return null;
    }
    return match[1];
}

function localDateKey(date: Date): string {
    return [
        date.getFullYear().toString().padStart(4, "0"),
        (date.getMonth() + 1).toString().padStart(2, "0"),
        date.getDate().toString().padStart(2, "0")
    ].join("-");
}

function daysBefore(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

function isValidDateKey(value: string): boolean {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) {
        return false;
    }
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year
        && date.getMonth() === month - 1
        && date.getDate() === day;
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}
