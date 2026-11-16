import type { Jarvix } from "../core/index.ts";
import type { JarvixEvent } from "../protocol/event.ts";
import { IPC_CHANNELS, type JarvixEventBatch } from "../protocol/ipc.ts";
import type { MainWindowController } from "./window.ts";

const FLUSH_INTERVAL_MS = 32;

type Flush = (events: JarvixEvent[]) => void;

/**
 * Coalesces stream deltas in the main process so the renderer receives at most
 * one batch per interval. Lifecycle events flush immediately to keep their order.
 */
function createStreamBatcher(flush: Flush): { push(event: JarvixEvent): void } {
    let pending: JarvixEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emit = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (pending.length === 0) {
            return;
        }
        const events = pending;
        pending = [];
        flush(events);
    };

    return {
        push(event: JarvixEvent): void {
            if (event.type === "text.delta") {
                const last = pending[pending.length - 1];
                if (last?.type === "text.delta" && last.index === event.index) {
                    pending[pending.length - 1] = {
                        type: "text.delta",
                        index: event.index,
                        delta: last.delta + event.delta
                    };
                } else {
                    pending.push(event);
                }
                timer ??= setTimeout(emit, FLUSH_INTERVAL_MS);
                return;
            }

            if (event.type === "thinking.delta") {
                const last = pending[pending.length - 1];
                if (last?.type === "thinking.delta" && last.index === event.index) {
                    pending[pending.length - 1] = {
                        type: "thinking.delta",
                        index: event.index,
                        delta: last.delta + event.delta
                    };
                } else {
                    pending.push(event);
                }
                timer ??= setTimeout(emit, FLUSH_INTERVAL_MS);
                return;
            }

            if (event.type === "tool.output") {
                const last = pending[pending.length - 1];
                if (
                    last?.type === "tool.output" &&
                    last.toolCallId === event.toolCallId &&
                    last.data.kind === event.data.kind
                ) {
                    pending[pending.length - 1] = {
                        ...event,
                        data: {
                            ...event.data,
                            output: last.data.output + event.data.output
                        } as typeof event.data
                    };
                } else {
                    pending.push(event);
                }
                timer ??= setTimeout(emit, FLUSH_INTERVAL_MS);
                return;
            }

            if (event.type === "backgroundTask.output") {
                const last = pending[pending.length - 1];
                if (last?.type === "backgroundTask.output" && last.taskId === event.taskId) {
                    pending[pending.length - 1] = {
                        ...event,
                        output: last.output + event.output
                    };
                } else {
                    pending.push(event);
                }
                timer ??= setTimeout(emit, FLUSH_INTERVAL_MS);
                return;
            }

            pending.push(event);
            emit();
        }
    };
}

export function attachEventBridge(
    jarvix: Pick<Jarvix, "subscribe">,
    windows: MainWindowController
): () => void {
    const batchers = new Map<string, ReturnType<typeof createStreamBatcher>>();

    return jarvix.subscribe((event, sessionId) => {
        let batcher = batchers.get(sessionId);
        if (!batcher) {
            batcher = createStreamBatcher((events) => {
                const batch: JarvixEventBatch = { sessionId, events };
                windows.send(IPC_CHANNELS.event, batch);
            });
            batchers.set(sessionId, batcher);
        }
        batcher.push(event);
    });
}
