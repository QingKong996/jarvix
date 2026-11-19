const INITIAL_BODY_CAPACITY_BYTES = 64 * 1024;

/** Read a JSON response without allowing a remote body to exceed a fixed byte budget. */
export async function readJsonResponse(
    response: Response,
    maxBytes: number,
    label: string
): Promise<unknown> {
    const declaredLength = contentLength(response);
    if (declaredLength !== undefined && declaredLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`${label}: response exceeds ${maxBytes} bytes`);
    }
    if (!response.body) {
        throw new Error(`${label}: empty response`);
    }

    const reader = response.body.getReader();
    let bytes = new Uint8Array(Math.min(maxBytes, INITIAL_BODY_CAPACITY_BYTES));
    let totalBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            totalBytes += chunk.value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new Error(`${label}: response exceeds ${maxBytes} bytes`);
            }
            if (totalBytes > bytes.length) {
                let capacity = Math.max(bytes.length, 1);
                while (capacity < totalBytes) {
                    capacity = Math.min(maxBytes, capacity * 2);
                }
                const grown = new Uint8Array(capacity);
                grown.set(bytes);
                bytes = grown;
            }
            const offset = totalBytes - chunk.value.byteLength;
            bytes.set(chunk.value, offset);
        }
        return JSON.parse(new TextDecoder().decode(bytes.subarray(0, totalBytes)));
    } finally {
        reader.releaseLock();
    }
}

function contentLength(response: Response): number | undefined {
    const value = response.headers.get("content-length");
    if (value === null) {
        return undefined;
    }
    const length = Number(value);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}
