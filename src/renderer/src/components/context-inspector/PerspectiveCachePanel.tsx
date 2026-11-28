import { useMemo } from "react";
import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceDot,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";
import type { JarvixCacheUsagePoint } from "../../../../protocol/provider-context.ts";
import {
    perspectiveCacheFor,
    type PerspectiveCacheAnomaly,
    type PerspectiveCachePoint
} from "./perspective-cache.ts";

export function PerspectiveCachePanel({
    history
}: {
    history: readonly JarvixCacheUsagePoint[];
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const cache = useMemo(() => perspectiveCacheFor(history), [history]);
    if (!cache) {
        return null;
    }
    const yAxis = cacheYAxis(cache.points);
    const anomalyCount = cache.anomalies.length;

    return (
        <section
            data-testid="perspective-cache"
            data-anomaly-count={anomalyCount}
            className="shrink-0 border-b border-border bg-sidebar/45 px-3 py-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                    <Database className="size-3.5 shrink-0 text-muted-foreground" />
                    <h3 className="truncate text-[11px] font-medium">
                        {t("rightSidebar.context.cache.title")}
                    </h3>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                    {formatHitRate(cache.latestHitRate, locale)}
                </span>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                <span>
                    {t("rightSidebar.context.cache.average", {
                        rate: formatHitRate(cache.averageHitRate, locale)
                    })}
                </span>
                {anomalyCount > 0 ? (
                    <span className="text-warning">
                        {t("rightSidebar.context.cache.anomalyCount", {
                            count: anomalyCount
                        })}
                    </span>
                ) : null}
            </div>

            <div className="relative mt-1 h-[112px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={cache.points}
                        margin={{ top: 6, right: 3, bottom: 0, left: 0 }}
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
                            tickMargin={5}
                            tick={{
                                fill: "var(--muted-foreground)",
                                fontSize: 9
                            }}
                            tickFormatter={(value: number | string) => (
                                `#${value}`
                            )}
                        />
                        <YAxis
                            width={yAxis.width}
                            domain={yAxis.domain}
                            ticks={yAxis.ticks}
                            axisLine={false}
                            tickLine={false}
                            tick={{
                                fill: "var(--muted-foreground)",
                                fontSize: 9
                            }}
                            tickFormatter={(value: number) => (
                                formatAxisHitRate(
                                    value,
                                    yAxis.fractionDigits,
                                    locale
                                )
                            )}
                        />
                        <Tooltip
                            cursor={{ stroke: "var(--border-strong)" }}
                            content={(
                                <CacheTrendTooltip locale={locale} />
                            )}
                        />
                        <Area
                            type="monotone"
                            dataKey="hitRate"
                            stroke="var(--success)"
                            fill="var(--success)"
                            fillOpacity={0.08}
                            strokeWidth={1.6}
                            dot={cache.points.length === 1
                                ? {
                                    r: 2.5,
                                    fill: "var(--success)",
                                    strokeWidth: 0
                                }
                                : false}
                            activeDot={{ r: 2.5, strokeWidth: 0 }}
                            isAnimationActive={false}
                        />
                        {cache.anomalies.map((point) => (
                            <ReferenceDot
                                key={`${point.step}:${point.atMs}:${point.anomaly}`}
                                x={point.step}
                                y={point.hitRate}
                                r={3.4}
                                fill={anomalyColor(point.anomaly)}
                                stroke="var(--background)"
                                strokeWidth={1.4}
                                ifOverflow="extendDomain"
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </section>
    );
}

function CacheTrendTooltip({
    active,
    payload,
    locale
}: {
    active?: boolean;
    payload?: Array<{ payload: PerspectiveCachePoint }>;
    locale: string;
}) {
    const { t } = useTranslation();
    const point = payload?.[0]?.payload;
    if (!active || !point) return null;
    return (
        <div className="min-w-36 rounded-lg border border-border-strong bg-popover px-2.5 py-1.5 text-[10px] shadow-lg">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                    {t("rightSidebar.context.usage.step", {
                        step: point.step
                    })}
                </span>
                <span className="text-[9px] text-muted-foreground">
                    {formatFullTime(point.atMs, locale)}
                </span>
            </div>
            <p className="mt-1 flex items-baseline justify-between gap-3 tabular-nums">
                <span className="text-muted-foreground">
                    {t("rightSidebar.context.cache.hitRate")}
                </span>
                <span className="font-medium text-foreground">
                    {formatHitRate(point.hitRate, locale)}
                </span>
            </p>
            <p className="mt-0.5 text-[9px] text-muted-foreground tabular-nums">
                {t("rightSidebar.context.cache.cacheTokens", {
                    read: formatCompact(point.cacheReadTokens, locale),
                    write: formatCompact(point.cacheWriteTokens, locale)
                })}
            </p>
            {point.anomaly ? (
                <p
                    className={point.anomaly === "high"
                        ? "mt-1 text-[9px] text-warning"
                        : "mt-1 text-[9px] text-destructive"}
                >
                    {t(point.anomaly === "high"
                        ? "rightSidebar.context.cache.anomalyHigh"
                        : "rightSidebar.context.cache.anomalyLow")}
                </p>
            ) : null}
        </div>
    );
}

function anomalyColor(anomaly: PerspectiveCacheAnomaly): string {
    return anomaly === "high"
        ? "var(--warning)"
        : "var(--destructive)";
}

type CacheYAxis = {
    domain: [number, number];
    ticks: number[];
    fractionDigits: number;
    width: number;
};

const AXIS_STEPS = [
    0.0001,
    0.0002,
    0.0005,
    0.001,
    0.002,
    0.005,
    0.01,
    0.02,
    0.025,
    0.05,
    0.1,
    0.2,
    0.25,
    0.5,
    1
] as const;
const MIN_AXIS_TICKS = 3;
const MAX_AXIS_TICKS = 5;
const AXIS_PADDING_RATIO = 0.12;
const MIN_AXIS_PADDING = 0.001;
const SINGLE_POINT_AXIS_PADDING = 0.01;
const AXIS_BOUND_OVERFLOW = 0.02;

function cacheYAxis(points: readonly PerspectiveCachePoint[]): CacheYAxis {
    const hitRates = points.map((point) => point.hitRate);
    const dataMin = Math.min(...hitRates);
    const dataMax = Math.max(...hitRates);
    const dataSpan = dataMax - dataMin;
    const padding = dataSpan === 0
        ? SINGLE_POINT_AXIS_PADDING
        : Math.max(dataSpan * AXIS_PADDING_RATIO, MIN_AXIS_PADDING);
    const domainMin = Math.max(-AXIS_BOUND_OVERFLOW, dataMin - padding);
    const domainMax = Math.min(1 + AXIS_BOUND_OVERFLOW, dataMax + padding);
    const candidates = AXIS_STEPS.map((step) => ({
        step,
        ticks: axisTicks(domainMin, domainMax, step)
    }));
    const best = candidates.find(({ ticks }) => (
        ticks.length >= MIN_AXIS_TICKS && ticks.length <= MAX_AXIS_TICKS
    )) ?? candidates.reduce((closest, candidate) => (
        Math.abs(candidate.ticks.length - MIN_AXIS_TICKS)
            < Math.abs(closest.ticks.length - MIN_AXIS_TICKS)
            ? candidate
            : closest
    ));
    const fractionDigits = axisFractionDigits(best.step);
    return {
        domain: [domainMin, domainMax],
        ticks: best.ticks,
        fractionDigits,
        width: 32 + fractionDigits * 5
    };
}

function axisTicks(
    domainMin: number,
    domainMax: number,
    step: number
): number[] {
    const start = Math.ceil(Math.max(0, domainMin) / step - 1e-9);
    const end = Math.floor(Math.min(1, domainMax) / step + 1e-9);
    if (end - start + 1 > MAX_AXIS_TICKS) {
        return [];
    }
    const ticks: number[] = [];
    for (let index = start; index <= end; index += 1) {
        const value = Number((index * step).toFixed(10));
        ticks.push(Object.is(value, -0) ? 0 : value);
    }
    return ticks;
}

function axisFractionDigits(step: number): number {
    const percentStep = step * 100;
    for (let digits = 0; digits <= 2; digits += 1) {
        const scaled = percentStep * 10 ** digits;
        if (Math.abs(scaled - Math.round(scaled)) < 1e-6) {
            return digits;
        }
    }
    return 2;
}

function formatHitRate(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatAxisHitRate(
    value: number,
    fractionDigits: number,
    locale: string
): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: fractionDigits
    }).format(value);
}

function formatCompact(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1
    }).format(value);
}

function formatFullTime(ms: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(ms));
}
