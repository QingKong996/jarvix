import { useMemo } from "react";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";
import type { JarvixContextUsage } from "../../../../protocol/context-usage.ts";
import type {
    JarvixContextBreakdown,
    JarvixContextUsagePoint
} from "../../../../protocol/provider-context.ts";
import {
    contextTrendFor,
    perspectiveContextParts,
    type PerspectiveContextKind
} from "./perspective-context.ts";

type PerspectiveContextPanelProps = {
    usage: JarvixContextUsage | null;
    history: readonly JarvixContextUsagePoint[];
    breakdown?: JarvixContextBreakdown;
};

const CONTEXT_COLORS: Record<PerspectiveContextKind, string> = {
    systemPrompt: "var(--context-system)",
    tools: "var(--context-tools)",
    user: "var(--context-user)",
    injected: "var(--context-injected)",
    assistant: "var(--context-assistant)",
    tool: "var(--context-tool)"
};

export function PerspectiveContextPanel({
    usage,
    history,
    breakdown
}: PerspectiveContextPanelProps) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const points = useMemo(
        () => contextTrendFor(history, usage, Date.now()),
        [history, usage]
    );
    const parts = useMemo(
        () => perspectiveContextParts(breakdown, usage?.estimatedTokens)
            .filter((part) => part.tokens > 0),
        [breakdown, usage]
    );

    if (!usage && history.length === 0) {
        return null;
    }

    const hasUsage = usage !== null && usage.contextWindow > 0;
    const ratio = hasUsage
        ? Math.max(0, usage.estimatedTokens / usage.contextWindow)
        : null;
    const percentage = ratio === null
        ? "—"
        : formatPercent(ratio, locale);
    const used = usage
        ? formatInteger(usage.estimatedTokens, locale)
        : "—";
    const limit = usage
        ? formatInteger(usage.contextWindow, locale)
        : "—";

    return (
        <section
            data-testid="perspective-context"
            className="shrink-0 border-b border-border bg-sidebar/45 px-3 py-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                    <Gauge className="size-3.5 shrink-0 text-muted-foreground" />
                    <h3 className="truncate text-[11px] font-medium">
                        {t("rightSidebar.context.usage.title")}
                    </h3>
                </div>
                <span
                    className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                        ratio === null
                            ? "text-muted-foreground"
                            : usageTone(ratio)
                    }`}
                >
                    {percentage}
                </span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 text-[10px]">
                <span className="text-muted-foreground">
                    {t("rightSidebar.context.usage.tokens")}
                </span>
                <span className="min-w-0 truncate tabular-nums text-foreground">
                    <span className="font-medium">{used}</span>
                    <span className="text-muted-foreground"> / {limit}</span>
                </span>
            </div>
            <div
                role="progressbar"
                aria-label={t("rightSidebar.context.usage.occupancyAria", {
                    percent: percentage,
                    used,
                    limit
                })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ratio === null
                    ? 0
                    : Math.min(100, Math.round(ratio * 100))}
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-subtle"
            >
                {parts.length > 0 ? (
                    <span className="flex h-full">
                        {parts.map((part) => (
                            <span
                                key={part.kind}
                                className="h-full"
                                style={{
                                    width: hasUsage
                                        ? `${Math.min(
                                            100,
                                            part.tokens / usage.contextWindow * 100
                                        )}%`
                                        : `${part.share * 100}%`,
                                    backgroundColor: CONTEXT_COLORS[part.kind]
                                }}
                            />
                        ))}
                    </span>
                ) : (
                    <span
                        className={`block h-full rounded-full transition-[width] ${
                            ratio === null ? "" : usageBarTone(ratio)
                        }`}
                        style={{
                            width: ratio === null
                                ? "0%"
                                : `${Math.min(100, ratio * 100)}%`
                        }}
                    />
                )}
            </div>

            {parts.length > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    {parts.map((part) => {
                        const label = t(
                            `rightSidebar.context.breakdown.kinds.${part.kind}`
                        );
                        return (
                            <div
                                key={part.kind}
                                className="flex min-w-0 items-center gap-1.5 text-[9px]"
                                title={`${label} · ${formatInteger(
                                    part.tokens,
                                    locale
                                )} · ${formatPercent(part.share, locale)}`}
                            >
                                <span
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{
                                        backgroundColor: CONTEXT_COLORS[part.kind]
                                    }}
                                />
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                    {label}
                                </span>
                                <span className="shrink-0 tabular-nums text-foreground">
                                    {formatTokensCompact(part.tokens, locale)}
                                </span>
                                <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                                    {formatPercent(part.share, locale)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            <div className="mt-2.5">
                <p className="text-[10px] text-muted-foreground">
                    {t("rightSidebar.context.usage.trend")}
                </p>
                <div className="relative mt-1 h-24 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={points}
                            margin={{ top: 5, right: 2, bottom: 0, left: 0 }}
                        >
                            <CartesianGrid
                                vertical={false}
                                stroke="var(--border)"
                                strokeDasharray="2 4"
                            />
                            <XAxis
                                dataKey="step"
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                                minTickGap={20}
                                tickMargin={6}
                                tick={{
                                    fill: "var(--muted-foreground)",
                                    fontSize: 9
                                }}
                                tickFormatter={(value: number | string) => (
                                    `#${value}`
                                )}
                            />
                            <YAxis
                                width={38}
                                axisLine={false}
                                tickLine={false}
                                tick={{
                                    fill: "var(--muted-foreground)",
                                    fontSize: 9
                                }}
                                tickFormatter={(value: number) => (
                                    formatCompact(value, locale)
                                )}
                            />
                            <Tooltip
                                cursor={{ stroke: "var(--border-strong)" }}
                                content={(
                                    <ContextTrendTooltip locale={locale} />
                                )}
                            />
                            <Area
                                type="stepAfter"
                                dataKey="estimatedTokens"
                                stroke="var(--timing-output)"
                                fill="var(--timing-output)"
                                fillOpacity={0.08}
                                strokeWidth={1.6}
                                dot={points.length === 1
                                    ? {
                                        r: 2.5,
                                        fill: "var(--timing-output)",
                                        strokeWidth: 0
                                    }
                                    : false}
                                activeDot={{ r: 2.5, strokeWidth: 0 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                    {points.length === 0 ? (
                        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                            {t("rightSidebar.context.usage.emptyTrend")}
                        </p>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function ContextTrendTooltip({
    active,
    payload,
    locale
}: {
    active?: boolean;
    payload?: Array<{ payload: JarvixContextUsagePoint }>;
    locale: string;
}) {
    const { t } = useTranslation();
    const point = payload?.[0]?.payload;
    if (!active || !point) return null;
    return (
        <div className="min-w-32 rounded-lg border border-border-strong bg-popover px-2.5 py-1.5 text-[10px] shadow-lg">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                    {point.current
                        ? t("rightSidebar.context.usage.current")
                        : t("rightSidebar.context.usage.step", {
                            step: point.step
                        })}
                </span>
                <span className="text-[9px] text-muted-foreground">
                    {formatFullTime(point.atMs, locale)}
                </span>
            </div>
            <p className="mt-1 flex items-baseline justify-between gap-3 tabular-nums">
                <span className="text-muted-foreground">
                    {t("rightSidebar.context.usage.tokens")}
                </span>
                <span className="font-medium text-foreground">
                    {formatInteger(point.estimatedTokens, locale)}
                </span>
            </p>
        </div>
    );
}

function usageTone(ratio: number): string {
    if (ratio >= 0.9) return "text-destructive";
    if (ratio >= 0.7) return "text-warning";
    return "text-foreground";
}

function usageBarTone(ratio: number): string {
    if (ratio >= 0.9) return "bg-destructive";
    if (ratio >= 0.7) return "bg-warning";
    return "bg-success";
}

function formatPercent(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: value < 0.1 ? 1 : 0
    }).format(value);
}

function formatInteger(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0
    }).format(value);
}

function formatCompact(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1
    }).format(value);
}

function formatTokensCompact(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, value >= 10_000
        ? {
            notation: "compact",
            maximumFractionDigits: 1
        }
        : {
            maximumFractionDigits: 0
        }
    ).format(value);
}

function formatFullTime(ms: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(new Date(ms));
}
