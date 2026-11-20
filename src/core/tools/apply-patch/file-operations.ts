import {
    mkdirSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
import { dirname } from "node:path";

export function writeFile(path: string, contents: string, context: string): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents, "utf8");
    } catch (error) {
        throw new Error(`${context} ${path}: ${errorMessage(error)}`);
    }
}

export function createFile(path: string, contents: string): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents, {
            encoding: "utf8",
            flag: "wx"
        });
    } catch (error) {
        throw new Error(`Failed to create file ${path}: ${errorMessage(error)}`);
    }
}

export function deleteFile(
    path: string,
    context = "Failed to delete file"
): void {
    try {
        assertDeleteTargetIsFile(path);
        rmSync(path);
    } catch (error) {
        throw new Error(`${context} ${path}: ${errorMessage(error)}`);
    }
}

export function assertDeleteTargetIsFile(path: string): void {
    if (statSync(path).isDirectory()) {
        throw new Error("path is a directory");
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
