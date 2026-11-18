import type { JarvixEvent } from "../../protocol/event.ts";

/**
 * Filters renderer events while an aborted request is winding down.
 * Tool results are kept so the stopped assistant turn can finish cleanly.
 */
export class RequestEventGate {
    private readonly paused = new Set<string>();
    private readonly awaitingStart = new Set<string>();

    pause(sessionId: string): void {
        this.paused.add(sessionId);
        this.awaitingStart.delete(sessionId);
    }

    resume(sessionId: string): void {
        if (this.paused.delete(sessionId)) {
            this.awaitingStart.add(sessionId);
        }
    }

    cancelPause(sessionId: string): void {
        this.paused.delete(sessionId);
        this.awaitingStart.delete(sessionId);
    }

    filter(sessionId: string, events: readonly JarvixEvent[]): JarvixEvent[] {
        if (this.awaitingStart.has(sessionId)) {
            const startIndex = events.findIndex((event) => event.type === "start");
            if (startIndex === -1) {
                return events.filter(isRetainedWhileStopped);
            }
            this.awaitingStart.delete(sessionId);
            return [
                ...events.slice(0, startIndex).filter(isRetainedWhileStopped),
                ...events.slice(startIndex)
            ];
        }
        if (this.paused.has(sessionId)) {
            return events.filter(isRetainedWhileStopped);
        }
        return [...events];
    }
}

function isRetainedWhileStopped(event: JarvixEvent): boolean {
    return event.type === "tool.end"
        || event.type === "session.renamed"
        || event.type.startsWith("backgroundTask.")
        || (
            event.type === "system.message"
            && event.message.notice?.kind === "background.task_exit"
        );
}
