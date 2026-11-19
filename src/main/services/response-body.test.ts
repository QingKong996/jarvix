import { expect, test, vi } from "vitest";
import { readJsonResponse } from "./response-body.ts";

test("reads valid JSON within the byte budget", async () => {
    const response = new Response(JSON.stringify({ ok: true }));

    await expect(readJsonResponse(response, 64, "test")).resolves.toEqual({ ok: true });
});

test("rejects declared and streamed bodies above the byte budget", async () => {
    const declared = new Response("{}", { headers: { "content-length": "64" } });
    await expect(readJsonResponse(declared, 32, "test")).rejects.toThrow(
        "test: response exceeds 32 bytes"
    );

    const streamed = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(33));
            controller.close();
        }
    }));
    await expect(readJsonResponse(streamed, 32, "test")).rejects.toThrow(
        "test: response exceeds 32 bytes"
    );
});

test("decodes a fragmented stream once instead of once per chunk", async () => {
    const payload = JSON.stringify({ text: "分段 UTF-8：你好🙂" });
    const encoded = new TextEncoder().encode(payload);
    const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const byte of encoded) {
                controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
        }
    }));
    const decode = vi.spyOn(TextDecoder.prototype, "decode");

    try {
        await expect(readJsonResponse(response, 1024, "test")).resolves.toEqual({
            text: "分段 UTF-8：你好🙂"
        });
        expect(decode).toHaveBeenCalledTimes(1);
    } finally {
        decode.mockRestore();
    }
});

test("coalesces fragmented chunks instead of retaining one entry per fragment", async () => {
    const text = "fragment ".repeat(512);
    const payload = JSON.stringify({ text });
    const encoded = new TextEncoder().encode(payload);
    const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const byte of encoded) {
                controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
        }
    }));
    const originalPush = Array.prototype.push;
    let pushCalls = 0;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]): number {
        pushCalls += 1;
        return Reflect.apply(originalPush, this, items);
    } as typeof Array.prototype.push;

    try {
        await expect(readJsonResponse(response, 16 * 1024, "test")).resolves.toEqual({ text });
    } finally {
        Array.prototype.push = originalPush;
    }

    expect(pushCalls).toBeLessThan(20);
});
