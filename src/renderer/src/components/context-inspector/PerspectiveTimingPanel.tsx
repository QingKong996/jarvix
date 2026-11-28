import { Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart } from "recharts";
import type {
    PerspectiveTiming,
    PerspectiveTimingKind
} from "./perspective-timing.ts";

const TIMING_COLORS: Record<PerspectiveTimingKind, string> = {
    waiting: "var(--timing-waiting)",
    thinking: "var(--timing-thinking)",
    output: "var(--timing-output)",
    toolArgs: "var(--timing-tool-args)",
    tool: "var(--timing-tool)"
};

export function PerspectiveTimingPanel({ timing }: { timing: PerspectiveTiming }) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const categories = timing.categories.filter(
        (category) => category.durationMs > 0
    );
    const hasTiming = timing.totalMs > 0 && categories.length > 0;

    return (
        <section
            data-testid="perspective-timing"
            className="shrink-0 border-b border-border bg-sidebar/45 px-3 py-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                    <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />
                    <h3 className="truncate text-[11px] font-medium">
                        {t("rightSidebar.context.timing.title")}
                    </h3>
                </div>
                {hasTiming && timing.startedAt !== null ? (
                    <span
                        className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                        title={formatFullTime(timing.startedAt, locale)}
                    >
                        {formatClockTime(timing.startedAt, locale)}
                    </span>
                ) : null}
            </div>

            {hasTiming ? (
                <>
                    <div className="mt-2 flex items-center gap-3">
                        <div className="relative size-[88px] shrink-0">
                            <PieChart
                                width={88}
                                height={88}
                                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                            >
                                <Pie
                                    data={categories}
                                    dataKey="durationMs"
                                    nameKey="kind"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={28}
                                    outerRadius={40}
                                    paddingAngle={categories.length > 1 ? 1.5 : 0}
                                    startAngle={90}
                                    endAngle={-270}
                                    stroke="var(--card)"
                                    strokeWidth={1.5}
                                    isAnimationActive={false}
                                >
                                    {categories.map((category) => (
                                        <Cell
                                            key={category.kind}
                                            fill={TIMING_COLORS[category.kind]}
                                        />
                                    ))}
                                </Pie>
                            </PieChart>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-[9px] text-muted-foreground">
                                    {t("rightSidebar.context.timing.total")}
                                </span>
                                <span className="max-w-16 truncate text-[12px] font-semibold tabular-nums text-foreground">
                                    {formatDuration(timing.totalMs, locale)}
                                </span>
                            </div>
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                            {categories.map((category) => (
                                <div
                                    key={category.kind}
                                    className="flex min-w-0 items-center gap-1.5 text-[10px]"
                                >
                                    <span
                                        className="size-1.5 shrink-0 rounded-full"
                                        style={{
                                            backgroundColor: TIMING_COLORS[category.kind]
                                        }}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                        {t(`rightSidebar.context.timing.kinds.${category.kind}`)}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-foreground">
                                        {formatDuration(category.durationMs, locale)}
                                    </span>
                                    <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                                        {formatPercent(category.share, locale)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground">
                                {t("rightSidebar.context.timing.timeline")}
                            </span>
                            {timing.endedAt !== null ? (
                                <span
                                    className="text-[10px] tabular-nums text-muted-foreground"
                                    title={formatFullTime(timing.endedAt, locale)}
                                >
                                    {formatClockTime(timing.endedAt, locale)}
                                </span>
                            ) : null}
                        </div>
                        <div
                            role="img"
                            aria-label={t("rightSidebar.context.timing.timelineAria", {
                                duration: formatDuration(timing.totalMs, locale)
                            })}
                            className="flex h-2.5 overflow-hidden rounded-full bg-surface-subtle"
                        >
                            {timing.spans.map((span, index) => {
                                const label = t(
                                    `rightSidebar.context.timing.kinds.${span.kind}`
                                );
                                return (
                                    <span
                                        key={`${span.kind}-${span.startedAt}-${index}`}
                                        title={[
                                            label,
                                            span.label,
                                            formatDuration(span.durationMs, locale)
                                        ].filter(Boolean).join(" · ")}
                                        className="h-full"
                                        style={{
                                            flexBasis: 0,
                                            flexGrow: span.durationMs,
                                            backgroundColor: TIMING_COLORS[span.kind]
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
                            <span>0</span>
                            <span>{formatDuration(timing.totalMs / 2, locale)}</span>
                            <span>{formatDuration(timing.totalMs, locale)}</span>
                        </div>
                    </div>
                </>
            ) : (
                <p className="mt-1 text-[10px] text-muted-foreground">
                    {t("rightSidebar.context.timing.empty")}
                </p>
            )}
        </section>
    );
}

function formatDuration(ms: number, locale: string): string {
    const rounded = Math.max(0, Math.round(ms));
    if (rounded < 1_000) {
        return `${new Intl.NumberFormat(locale).format(rounded)}ms`;
    }
    if (rounded < 59_950) {
        return `${new Intl.NumberFormat(locale, {
            maximumFractionDigits: 1
        }).format(rounded / 1_000)}s`;
    }
    const totalSeconds = Math.round(rounded / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) {
        return `${minutes}m ${totalSeconds % 60}s`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

function formatPercent(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: value < 0.1 ? 1 : 0
    }).format(value);
}

function formatClockTime(ms: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(new Date(ms));
}

function formatFullTime(ms: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(new Date(ms));
}
