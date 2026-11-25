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
    writeFileSync,
    writeSync
} from "node:fs";
import { dirname } from "node:path";
import type { JarvixSessionMeta } from "../../../protocol/session.ts";
import type { LlmMessage } from "../../../protocol/llm.ts";
import {
    assertSessionMetaFits,
    serializeRecord,
    type SessionRecord
} from "./records.ts";

const SESSION_FILE_MODE = 0o600;
const SESSION_COPY_CHUNK_SIZE = 64 * 1024;

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
    const contents = serializeRecord(meta);
    assertSessionMetaFits(contents);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        const source = openSync(file, "r");
        try {
            const sourceMode = fstatSync(source).mode & 0o777;
            const target = openSync(temporary, "wx", sourceMode || SESSION_FILE_MODE);
            try {
                writeAll(target, Buffer.from(contents, "utf8"));
                copySessionBody(source, target);
            } finally {
                closeSync(target);
            }
        } finally {
            closeSync(source);
        }
        renameSync(temporary, file);
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

function copySessionBody(source: number, target: number): void {
    const buffer = Buffer.allocUnsafe(SESSION_COPY_CHUNK_SIZE);
    let copyingBody = false;
    while (true) {
        const bytesRead = readSync(source, buffer, 0, buffer.length, null);
        if (bytesRead === 0) {
            return;
        }
        const chunk = buffer.subarray(0, bytesRead);
        if (copyingBody) {
            writeAll(target, chunk);
            continue;
        }

        const newline = chunk.indexOf(0x0a);
        if (newline === -1) {
            continue;
        }
        copyingBody = true;
        if (newline + 1 < bytesRead) {
            writeAll(target, chunk.subarray(newline + 1));
        }
    }
}

function writeAll(descriptor: number, buffer: Buffer): void {
    let offset = 0;
    while (offset < buffer.length) {
        const bytesWritten = writeSync(
            descriptor,
            buffer,
            offset,
            buffer.length - offset
        );
        if (bytesWritten === 0) {
            throw new Error("Failed to write session metadata");
        }
        offset += bytesWritten;
    }
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
