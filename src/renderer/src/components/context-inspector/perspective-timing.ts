import type { LlmMessage } from "../../../../protocol/llm.ts";

export const PERSPECTIVE_TIMING_KINDS = [
    "waiting",
    "thinking",
    "output",
    "toolArgs",
    "tool"
] as const;

export type PerspectiveTimingKind =
    (typeof PERSPECTIVE_TIMING_KINDS)[number];

export type PerspectiveTimingSpan = {
    kind: PerspectiveTimingKind;
    startedAt: number;
    durationMs: number;
    label?: string;
};

export type PerspectiveTimingCategory = {
    kind: PerspectiveTimingKind;
    durationMs: number;
    share: number;
};

export type PerspectiveTiming = {
    spans: PerspectiveTimingSpan[];
    categories: PerspectiveTimingCategory[];
    totalMs: number;
    startedAt: number | null;
    endedAt: number | null;
};

export function perspectiveTimingFor(
    messages: readonly LlmMessage[]
): PerspectiveTiming {
    const spans: PerspectiveTimingSpan[] = [];

    for (const message of messages) {
        if (message.role === "assistant" && message.timing) {
            for (const span of message.timing.spans) {
                appendSpan(spans, {
                    kind: span.kind,
                    startedAt: span.startedAt,
                    durationMs: span.durationMs
                });
            }
        } else if (message.role === "toolResult" && message.timing) {
            appendSpan(spans, {
                kind: "tool",
                startedAt: message.timing.startedAt,
                durationMs: message.timing.durationMs,
                label: message.toolName
            });
        }
    }

    spans.sort((left, right) => left.startedAt - right.startedAt);

    const durations = new Map<PerspectiveTimingKind, number>();
    let totalMs = 0;
    let startedAt: number | null = null;
    let endedAt: number | null = null;

    for (const span of spans) {
        durations.set(span.kind, (durations.get(span.kind) ?? 0) + span.durationMs);
        totalMs += span.durationMs;
        startedAt = startedAt === null
            ? span.startedAt
            : Math.min(startedAt, span.startedAt);
        endedAt = endedAt === null
            ? span.startedAt + span.durationMs
            : Math.max(endedAt, span.startedAt + span.durationMs);
    }

    return {
        spans,
        categories: PERSPECTIVE_TIMING_KINDS.map((kind) => {
            const durationMs = durations.get(kind) ?? 0;
            return {
                kind,
                durationMs,
                share: totalMs > 0 ? durationMs / totalMs : 0
            };
        }),
        totalMs,
        startedAt,
        endedAt
    };
}

function appendSpan(
    spans: PerspectiveTimingSpan[],
    span: PerspectiveTimingSpan
): void {
    if (
        !Number.isFinite(span.startedAt)
        || !Number.isFinite(span.durationMs)
        || span.durationMs <= 0
    ) {
        return;
    }
    spans.push({
        ...span,
        durationMs: Math.round(span.durationMs)
    });
}
