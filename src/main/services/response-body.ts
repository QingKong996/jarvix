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
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = "";
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
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return JSON.parse(text);
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
