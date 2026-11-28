import type { JarvixContextUsage } from "../../../../protocol/context-usage.ts";
import type {
    JarvixContextBreakdown,
    JarvixContextUsagePoint
} from "../../../../protocol/provider-context.ts";

const MAX_TREND_POINTS = 120;

export const PERSPECTIVE_CONTEXT_KINDS = [
    "systemPrompt",
    "tools",
    "user",
    "injected",
    "assistant",
    "tool"
] as const;

export type PerspectiveContextKind =
    (typeof PERSPECTIVE_CONTEXT_KINDS)[number];

export type PerspectiveContextPart = {
    kind: PerspectiveContextKind;
    tokens: number;
    share: number;
};

export function contextTrendFor(
    history: readonly JarvixContextUsagePoint[],
    usage: JarvixContextUsage | null,
    nowMs: number
): JarvixContextUsagePoint[] {
    const points: JarvixContextUsagePoint[] = history
        .filter((point) => (
            Number.isFinite(point.step)
            && point.step > 0
            && Number.isFinite(point.atMs)
            && Number.isFinite(point.estimatedTokens)
            && point.estimatedTokens >= 0
        ))
        .map((point) => ({
            step: Math.max(1, Math.round(point.step)),
            atMs: point.atMs,
            estimatedTokens: Math.round(point.estimatedTokens)
        }))
        .sort((left, right) => left.step - right.step)
        .slice(-MAX_TREND_POINTS);

    if (usage && Number.isFinite(usage.estimatedTokens)) {
        const lastStep = points.at(-1)?.step ?? 0;
        const lastAt = points.at(-1)?.atMs;
        points.push({
            step: lastStep + 1,
            atMs: Math.max(
                nowMs,
                lastAt === undefined ? nowMs : lastAt + 1
            ),
            estimatedTokens: Math.max(0, Math.round(usage.estimatedTokens)),
            current: true
        });
    }

    return points.slice(-MAX_TREND_POINTS);
}

export function perspectiveContextParts(
    breakdown: JarvixContextBreakdown | undefined,
    usedTokens: number | null | undefined
): PerspectiveContextPart[] {
    if (!breakdown) {
        return [];
    }
    const raw = PERSPECTIVE_CONTEXT_KINDS.map((kind) => ({
        kind,
        tokens: tokenCount(breakdown[kind])
    }));
    const rawTotal = raw.reduce((sum, part) => sum + part.tokens, 0);
    if (rawTotal <= 0) {
        return [];
    }
    const target = typeof usedTokens === "number"
        && Number.isFinite(usedTokens)
        && usedTokens > 0
        ? Math.round(usedTokens)
        : rawTotal;
    const scaled = scaleCounts(raw, target);
    return scaled.map((part) => ({
        ...part,
        share: target > 0 ? part.tokens / target : 0
    }));
}

function scaleCounts(
    parts: readonly Pick<PerspectiveContextPart, "kind" | "tokens">[],
    target: number
): Pick<PerspectiveContextPart, "kind" | "tokens">[] {
    const rawTotal = parts.reduce((sum, part) => sum + part.tokens, 0);
    if (rawTotal <= 0 || target <= 0) {
        return parts.map((part) => ({ ...part, tokens: 0 }));
    }
    const scaled = parts.map((part, index) => {
        const exact = part.tokens * target / rawTotal;
        return {
            index,
            kind: part.kind,
            tokens: Math.floor(exact),
            fraction: exact - Math.floor(exact)
        };
    });
    let remainder = target - scaled.reduce(
        (sum, part) => sum + part.tokens,
        0
    );
    const order = [...scaled].sort((left, right) => (
        right.fraction - left.fraction || right.tokens - left.tokens
    ));
    for (let index = 0; remainder > 0; index += 1) {
        const part = order[index % order.length]!;
        scaled[part.index]!.tokens += 1;
        remainder -= 1;
    }
    return scaled.map(({ kind, tokens }) => ({ kind, tokens }));
}

function tokenCount(value: number): number {
    return Number.isFinite(value) && value > 0
        ? Math.round(value)
        : 0;
}
