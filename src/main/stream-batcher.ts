import type { JarvixEvent } from "../protocol/event.ts";

const FLUSH_INTERVAL_MS = 32;

type Flush = (events: JarvixEvent[]) => void;

/**
 * Coalesces stream deltas in the main process so the renderer receives at most
 * one batch per interval. Lifecycle events flush immediately to keep their order.
 */
export function createStreamBatcher(flush: Flush): { push(event: JarvixEvent): void } {
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

            pending.push(event);
            emit();
        }
    };
}
