import type {
    LlmAssistantTiming,
    LlmStreamEvent,
    LlmTimingSpan,
    LlmTimingSpanKind
} from "../../../protocol/llm.ts";

export class AssistantTimingCollector {
    private readonly startedAtMs: number;
    private readonly startedAt: number;
    private readonly now: () => number;
    private readonly spans: LlmTimingSpan[] = [];
    private cursorAt: number;
    private cursorKind: LlmTimingSpanKind = "waiting";
    private firstTokenAt: number | undefined;

    constructor(startedAtMs: number, now: () => number = monotonicNow) {
        this.startedAtMs = startedAtMs;
        this.now = now;
        this.startedAt = now();
        this.cursorAt = this.startedAt;
    }

    observe(event: LlmStreamEvent): void {
        const kind = timingKindFor(event);
        if (!kind) {
            return;
        }
        const at = this.now();
        if (kind !== this.cursorKind) {
            this.closeSpan(at);
            this.cursorKind = kind;
        }
        this.firstTokenAt ??= this.wallClock(at);
    }

    finish(): LlmAssistantTiming {
        const at = this.now();
        this.closeSpan(at);
        const endedAt = this.wallClock(at);
        return {
            startedAt: this.startedAtMs,
            endedAt,
            durationMs: Math.max(0, endedAt - this.startedAtMs),
            ...(this.firstTokenAt === undefined
                ? {}
                : { firstTokenAt: this.firstTokenAt }),
            spans: [...this.spans]
        };
    }

    private closeSpan(at: number): void {
        const durationMs = Math.max(0, Math.round(at - this.cursorAt));
        if (durationMs > 0) {
            this.spans.push({
                kind: this.cursorKind,
                startedAt: this.wallClock(this.cursorAt),
                durationMs
            });
        }
        this.cursorAt = at;
    }

    private wallClock(at: number): number {
        return this.startedAtMs + Math.max(0, Math.round(at - this.startedAt));
    }
}

function timingKindFor(event: LlmStreamEvent): LlmTimingSpanKind | undefined {
    switch (event.type) {
        case "thinking.start":
        case "thinking.delta":
        case "thinking.end":
            return "thinking";
        case "text.start":
        case "text.delta":
        case "text.end":
            return "output";
        case "toolCall.start":
        case "toolCall.delta":
        case "toolCall.end":
            return "toolArgs";
        default:
            return undefined;
    }
}

function monotonicNow(): number {
    return performance.now();
}
