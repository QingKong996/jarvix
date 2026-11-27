import { randomUUID } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readSync,
    renameSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import type { LlmMessage } from "../../../protocol/llm.ts";
import {
    assertSessionMetaFits,
    serializeRecord,
    type SessionRecord
} from "./records.ts";
import { sessionMetaFileFor } from "./paths.ts";

const SESSION_FILE_MODE = 0o600;

export function createSessionFile(file: string, meta: JarvixSessionMeta): void {
    const contents = serializeRecord(meta);
    assertSessionMetaFits(contents);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });
}

export function writeSessionMeta(file: string, meta: JarvixSessionMeta): void {
    const target = sessionMetaFileFor(file);
    const contents = serializeRecord(meta);
    assertSessionMetaFits(contents);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    mkdirSync(dirname(target), { recursive: true });
    try {
        writeFileSync(temporary, contents, {
            encoding: "utf8",
            flag: "wx",
            mode: SESSION_FILE_MODE
        });
        renameSync(temporary, target);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // The temporary file may not have been created.
        }
        throw error;
    }
}

export function appendSessionRecord(file: string, record: SessionRecord): void {
    appendFileSync(file, `${trailingRecordSeparator(file)}${serializeRecord(record)}`, {
        encoding: "utf8",
        mode: SESSION_FILE_MODE
    });
}

export function appendSessionMessageToFile(file: string, message: LlmMessage): void {
    appendSessionRecord(file, {
        type: "message",
        message
    });
}

function trailingRecordSeparator(file: string): string {
    const descriptor = openSync(file, "r");
    try {
        const size = fstatSync(descriptor).size;
        if (size === 0) {
            return "";
        }
        const lastByte = Buffer.allocUnsafe(1);
        readSync(descriptor, lastByte, 0, 1, size - 1);
        return lastByte[0] === 0x0a ? "" : "\n";
    } finally {
        closeSync(descriptor);
    }
}
