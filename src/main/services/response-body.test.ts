import { expect, test } from "vitest";
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
