import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ReactNode
} from "react";
import {
    CalendarDays,
    LoaderCircle,
    Pencil,
    RefreshCw
} from "lucide-react";
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
import type { JarvixConfig } from "../../../../protocol/config.ts";
import type { ModelCost } from "../../../../protocol/providers.ts";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import {
    USAGE_PERIODS,
    type UsageAuditQuery,
    type UsagePeriod,
    type UsageRequest,
    type UsageStats
} from "../../../../protocol/usage.ts";
import { Button } from "../ui/button.tsx";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "../ui/select.tsx";
import {
    buildUsageBuckets,
    buildUsageChart,
    formatBucketTooltip,
    summarizeUsage,
    USAGE_METRICS,
    usageModelKey,
    type UsageChartPoint,
    type UsageLabels,
    type UsageMetric,
    type UsageSummary
} from "./usage-analytics.ts";
import { UsagePricingDialog } from "./UsagePricingDialog.tsx";

type UsagePanelProps = {
    config: JarvixConfig | null;
    sessions: JarvixSessionSummary[];
    onConfigChange: (config: JarvixConfig) => Promise<void>;
};

type PricingEditor = {
    provider: string;
    model: string;
    cost: ModelCost;
};

const bridge = window.jarvix;
const REQUEST_PAGE_SIZE = 30;
const AUTO_REFRESH_SECONDS = [0, 5, 10, 30] as const;

export function UsagePanel({
    config,
    sessions,
    onConfigChange
}: UsagePanelProps) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const [period, setPeriod] = useState<UsagePeriod>("today");
    const [customFrom, setCustomFrom] = useState(() => dateInputValue(-6));
    const [customTo, setCustomTo] = useState(() => dateInputValue(0));
    const [metric, setMetric] = useState<UsageMetric>("tokens");
    const [refreshSeconds, setRefreshSeconds] = useState(5);
    const [stats, setStats] = useState<UsageStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [visibleRequests, setVisibleRequests] = useState(REQUEST_PAGE_SIZE);
    const [pricingEditor, setPricingEditor] = useState<PricingEditor | null>(null);

    const refresh = useCallback(() => {
        setRevision((value) => value + 1);
    }, []);

    useEffect(() => {
        if (!bridge) return;
        let timer: number | undefined;
        const unsubscribe = bridge.onEvents((batch) => {
            if (!batch.events.some((event) => (
                event.type === "done" || event.type === "error"
            ))) {
                return;
            }
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(refresh, 350);
        });
        return () => {
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            unsubscribe();
        };
    }, [refresh]);

    useEffect(() => {
        if (refreshSeconds === 0) return;
        const timer = window.setInterval(refresh, refreshSeconds * 1_000);
        return () => window.clearInterval(timer);
    }, [refresh, refreshSeconds]);

    const customWindow = useMemo(() => {
        if (period !== "custom") return undefined;
        const fromMs = startOfDateInput(customFrom);
        const toDay = startOfDateInput(customTo);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toDay)) {
            return null;
        }
        const toMs = addLocalDays(toDay, 1);
        return toMs > fromMs ? { fromMs, toMs } : null;
    }, [customFrom, customTo, period]);

    const fetchQuery = useMemo<UsageAuditQuery | null>(() => {
        if (period !== "custom") return { period };
        return customWindow
            ? { period, fromMs: customWindow.fromMs, toMs: customWindow.toMs }
            : null;
    }, [customWindow, period]);
    const fetchKey = fetchQuery
        ? `${fetchQuery.period}:${fetchQuery.fromMs ?? ""}:${fetchQuery.toMs ?? ""}`
        : "";

    useEffect(() => {
        if (!bridge || !fetchQuery) {
            setStats(null);
            setLoading(false);
            return;
        }
        let active = true;
        setLoading(true);
        setError(null);
        void bridge.getUsageStats(fetchQuery)
            .then((next) => {
                if (active) setStats(next);
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [fetchKey, revision]);

    const configuredModels = useMemo(() => new Map(
        (config?.providers ?? []).flatMap((provider) => (
            provider.models.map((model) => [
                usageModelKey(provider.id, model.id),
                { cost: model.cost, provider, model }
            ] as const)
        ))
    ), [config?.providers]);
    const providerNames = useMemo(() => new Map(
        (config?.providers ?? []).map((provider) => [provider.id, provider.name])
    ), [config?.providers]);
    const modelNames = useMemo(() => new Map(
        (config?.providers ?? []).flatMap((provider) => (
            provider.models.map((model) => [
                usageModelKey(provider.id, model.id),
                model.name
            ] as const)
        ))
    ), [config?.providers]);
    const sessionNames = useMemo(() => new Map(
        sessions.map((session) => [session.id, session.name])
    ), [sessions]);
    const labels: UsageLabels = useMemo(() => ({
        modelNames,
        providerNames,
        sessionNames,
        unknownModel: t("rightSidebar.usage.unknownModel"),
        unknownProvider: t("rightSidebar.usage.unknownProvider"),
        unknownAgent: t("rightSidebar.usage.unknownAgent")
    }), [modelNames, providerNames, sessionNames, t]);

    const requests = stats?.requests ?? EMPTY_REQUESTS;
    const summary = useMemo(
        () => summarizeUsage(requests),
        [requests]
    );
    const buckets = useMemo(
        () => stats
            ? buildUsageBuckets(stats.period, stats.fromMs, stats.toMs, locale)
            : [],
        [locale, stats]
    );
    const chart = useMemo(
        () => buildUsageChart(requests, buckets, metric),
        [buckets, metric, requests]
    );

    useEffect(() => {
        setVisibleRequests(REQUEST_PAGE_SIZE);
    }, [fetchKey]);

    const displayError = period === "custom" && customWindow === null
        ? t("rightSidebar.usage.invalidCustomRange")
        : error;

    function openPricingEditor(provider: string, model: string): void {
        const configured = configuredModels.get(usageModelKey(provider, model));
        if (!configured) return;
        setPricingEditor({
            provider,
            model,
            cost: configured.cost
        });
    }

    async function savePricing(cost: ModelCost): Promise<void> {
        if (!config || !pricingEditor) return;
        const providers = config.providers?.map((provider) => (
            provider.id === pricingEditor.provider
                ? {
                    ...provider,
                    models: provider.models.map((model) => (
                        model.id === pricingEditor.model
                            ? { ...model, cost }
                            : model
                    ))
                }
                : provider
        ));
        if (!providers) return;
        await onConfigChange({ ...config, providers });
        refresh();
    }

    return (
        <section className="@container flex h-full min-h-0 flex-col bg-background">
            <div className="shrink-0 border-b border-border bg-sidebar/45 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        <span className="text-foreground">
                            {t("rightSidebar.usage.breadcrumb.observe")}
                        </span>
                        <span aria-hidden="true"> / </span>
                        {t("rightSidebar.usage.breadcrumb.usage")}
                        <span aria-hidden="true"> / </span>
                        <span className="text-foreground">
                            {t("rightSidebar.usage.breadcrumb.requests")}
                        </span>
                    </p>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                        {formatCost(summary.costUsd, locale)}
                    </span>
                    <span className="hidden shrink-0 text-[10px] text-muted-foreground @min-[24rem]:inline">
                        {t("rightSidebar.usage.activePrice")}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading || !bridge}
                        onClick={refresh}
                        className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                    >
                        <RefreshCw className={loading ? "animate-spin" : undefined} />
                        {t("rightSidebar.usage.update")}
                    </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                    {USAGE_PERIODS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={period === option}
                            onClick={() => setPeriod(option)}
                            className={[
                                "inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
                                period === option
                                    ? "border-border-strong bg-accent text-foreground"
                                    : "border-transparent bg-surface-subtle text-muted-foreground hover:text-foreground"
                            ].join(" ")}
                        >
                            {option === "custom" ? <CalendarDays className="size-3" /> : null}
                            {t(`rightSidebar.usage.periods.${option}`)}
                        </button>
                    ))}
                    {period === "custom" ? (
                        <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-1.5">
                            <DateInput
                                label={t("rightSidebar.usage.customStart")}
                                value={customFrom}
                                onChange={setCustomFrom}
                            />
                            <span aria-hidden="true" className="text-[10px] text-muted-foreground">
                                –
                            </span>
                            <DateInput
                                label={t("rightSidebar.usage.customEnd")}
                                value={customTo}
                                onChange={setCustomTo}
                            />
                        </span>
                    ) : null}
                    <Select
                        value={String(refreshSeconds)}
                        onValueChange={(value) => setRefreshSeconds(Number(value))}
                    >
                        <SelectTrigger
                            size="sm"
                            aria-label={t("rightSidebar.usage.autoRefresh")}
                            className="ml-auto h-7 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end" className="min-w-32">
                            {AUTO_REFRESH_SECONDS.map((seconds) => (
                                <SelectItem
                                    key={seconds}
                                    value={String(seconds)}
                                    className="py-1.5 text-[11px]"
                                >
                                    {seconds === 0
                                        ? t("rightSidebar.usage.autoRefreshOff")
                                        : t(
                                            "rightSidebar.usage.autoRefreshSeconds",
                                            { count: seconds }
                                        )}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-3 px-3 py-3">
                    {displayError ? (
                        <p role="alert" className="text-[11px] leading-relaxed text-destructive">
                            {displayError}
                        </p>
                    ) : null}
                    <UsageSummaryCard summary={summary} locale={locale} />

                    <section className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-2">
                            <div className="inline-flex h-7 items-center rounded-lg bg-surface-subtle p-0.5">
                                {USAGE_METRICS.map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        aria-pressed={metric === option}
                                        onClick={() => setMetric(option)}
                                        className={[
                                            "h-6 rounded-md px-2 text-[10px] font-medium transition-colors",
                                            metric === option
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        ].join(" ")}
                                    >
                                        {t(`rightSidebar.usage.chartMetrics.${option}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="relative min-w-0 p-2.5">
                            <div className="h-60 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart
                                        data={chart}
                                        margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                                    >
                                        <CartesianGrid
                                            vertical={false}
                                            stroke="var(--border)"
                                            strokeDasharray="2 4"
                                        />
                                        <XAxis
                                            dataKey="label"
                                            axisLine={false}
                                            tickLine={false}
                                            interval="preserveStartEnd"
                                            minTickGap={26}
                                            tickMargin={8}
                                            tick={{
                                                fill: "var(--muted-foreground)",
                                                fontSize: 9
                                            }}
                                        />
                                        <YAxis
                                            width={42}
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{
                                                fill: "var(--muted-foreground)",
                                                fontSize: 9
                                            }}
                                            tickFormatter={(value: number) => (
                                                formatAxisValue(value, metric, locale)
                                            )}
                                        />
                                        <Tooltip
                                            cursor={{ stroke: "var(--border-strong)" }}
                                            content={(
                                                <UsageChartTooltip
                                                    metric={metric}
                                                    locale={locale}
                                                />
                                            )}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke="#22c55e"
                                            fill="#22c55e"
                                            fillOpacity={0.08}
                                            strokeWidth={1.6}
                                            dot={false}
                                            activeDot={{ r: 2.5, strokeWidth: 0 }}
                                            isAnimationActive={false}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            {requests.length === 0 ? (
                                <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                                    {t("rightSidebar.usage.emptyChart")}
                                </p>
                            ) : null}
                            {loading ? (
                                <LoaderCircle className="absolute top-2 right-2 size-3.5 animate-spin text-muted-foreground" />
                            ) : null}
                        </div>
                    </section>

                    <section className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                            <h3 className="text-xs font-medium text-foreground">
                                {t("rightSidebar.usage.requests")}
                            </h3>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                                {formatInteger(requests.length, locale)}
                            </span>
                        </div>
                        {requests.length > 0 ? (
                            <>
                                <div className="divide-y divide-border">
                                    {requests
                                        .slice(0, visibleRequests)
                                        .map((request) => (
                                            <UsageRequestRow
                                                key={request.turnId}
                                                request={request}
                                                locale={locale}
                                                labels={labels}
                                                editable={Boolean(
                                                    request.provider
                                                    && request.model
                                                    && configuredModels.has(usageModelKey(
                                                        request.provider,
                                                        request.model
                                                    ))
                                                )}
                                                onEdit={() => openPricingEditor(
                                                    request.provider,
                                                    request.model
                                                )}
                                            />
                                        ))}
                                </div>
                                {visibleRequests < requests.length ? (
                                    <div className="border-t border-border p-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setVisibleRequests(
                                                (count) => count + REQUEST_PAGE_SIZE
                                            )}
                                            className="w-full text-[11px]"
                                        >
                                            {t("rightSidebar.usage.loadMore", {
                                                count: requests.length
                                                    - visibleRequests
                                            })}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                                {t("rightSidebar.usage.emptyRequests")}
                            </p>
                        )}
                    </section>
                </div>
            </div>

            {pricingEditor ? (
                <UsagePricingDialog
                    key={usageModelKey(
                        pricingEditor.provider,
                        pricingEditor.model
                    )}
                    open
                    provider={pricingEditor.provider}
                    model={pricingEditor.model}
                    cost={pricingEditor.cost}
                    onOpenChange={(open) => {
                        if (!open) setPricingEditor(null);
                    }}
                    onSave={savePricing}
                />
            ) : null}
        </section>
    );
}

function UsageSummaryCard({
    summary,
    locale
}: {
    summary: UsageSummary;
    locale: string;
}) {
    const { t } = useTranslation();
    const speedValue = summary.averageTokensPerSecond
        ? formatCompact(summary.averageTokensPerSecond, locale)
        : "0";
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-2">
                <div className="flex min-w-0 flex-col border-r border-border">
                    <SummaryCell
                        label={t("rightSidebar.usage.summary.tokens")}
                        value={formatCompact(summary.totalTokens, locale)}
                        className="border-b border-border"
                    >
                        {t("rightSidebar.usage.summary.tokenBreakdown", {
                            input: formatCompact(summary.inputTokens, locale),
                            output: formatCompact(summary.outputTokens, locale),
                            cache: formatCompact(summary.cacheTokens, locale)
                        })}
                    </SummaryCell>
                    <SummaryCell
                        label={t("rightSidebar.usage.summary.cost")}
                        value={formatCost(summary.costUsd, locale)}
                        className="border-b border-border"
                    >
                        {t("rightSidebar.usage.activePrice")}
                    </SummaryCell>
                    <SummaryCell
                        label={t("rightSidebar.usage.summary.outputSpeed")}
                        value={(
                            <span className="flex items-baseline gap-1">
                                {speedValue}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    {t("rightSidebar.usage.summary.tokensPerSecond")}
                                </span>
                            </span>
                        )}
                    >
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                            <span>
                                {summary.speedSamples > 0
                                    ? t("rightSidebar.usage.summary.timedSamples", {
                                        count: summary.speedSamples
                                    })
                                    : t("rightSidebar.usage.summary.noTiming")}
                            </span>
                            {summary.ttftSamples > 0 ? (
                                <span>
                                    {t("rightSidebar.usage.summary.ttft", {
                                        value: formatSeconds(
                                            summary.averageTtftMs,
                                            locale
                                        ),
                                        count: summary.ttftSamples
                                    })}
                                </span>
                            ) : null}
                        </span>
                    </SummaryCell>
                </div>

                <div className="flex min-w-0 flex-col">
                    <SummaryCell
                        label={t("rightSidebar.usage.summary.requests")}
                        value={formatInteger(summary.requests, locale)}
                        className="flex-1 border-b border-border"
                    >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-destructive">
                                {t("rightSidebar.usage.summary.failed", {
                                    count: summary.failed
                                })}
                            </span>
                            <span className="text-success">
                                {t("rightSidebar.usage.summary.successRate", {
                                    rate: formatPercent(
                                        summary.successRate,
                                        locale
                                    )
                                })}
                            </span>
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                            <span>
                                {t("rightSidebar.usage.summary.retried", {
                                    count: summary.retried
                                })}
                            </span>
                            <span>
                                {t("rightSidebar.usage.summary.cancelled", {
                                    count: summary.cancelled
                                })}
                            </span>
                        </span>
                        <span className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-border pt-2">
                            <span>
                                {t("rightSidebar.usage.summary.responseChars", {
                                    text: formatCompact(summary.textChars, locale),
                                    thinking: formatCompact(
                                        summary.thinkingChars,
                                        locale
                                    )
                                })}
                            </span>
                            <span>
                                {t("rightSidebar.usage.summary.charRate", {
                                    value: formatCompact(
                                        summary.averageCharsPerSecond,
                                        locale
                                    )
                                })}
                            </span>
                        </span>
                    </SummaryCell>
                    <SummaryCell
                        label={t("rightSidebar.usage.summary.cacheHitRate")}
                        value={formatPercent(summary.cacheHitRate, locale)}
                    >
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                            <span
                                className="block h-full rounded-full bg-success transition-[width]"
                                style={{
                                    width: `${Math.min(100, summary.cacheHitRate * 100)}%`
                                }}
                            />
                        </span>
                    </SummaryCell>
                </div>
            </div>
        </section>
    );
}

function SummaryCell({
    label,
    value,
    className,
    children
}: {
    label: string;
    value: ReactNode;
    className?: string;
    children?: ReactNode;
}) {
    return (
        <div className={`min-w-0 px-3 py-2.5 ${className ?? ""}`}>
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <div className="mt-0.5 truncate text-xl font-semibold tracking-tight text-foreground tabular-nums">
                {value}
            </div>
            <div className="mt-1 flex flex-col gap-0.5 text-[10px] leading-relaxed text-muted-foreground">
                {children}
            </div>
        </div>
    );
}

function UsageChartTooltip({
    active,
    payload,
    metric,
    locale
}: {
    active?: boolean;
    payload?: Array<{ payload: UsageChartPoint }>;
    metric: UsageMetric;
    locale: string;
}) {
    const { t } = useTranslation();
    const point = payload?.[0]?.payload;
    if (!active || !point) return null;
    return (
        <div className="min-w-36 rounded-lg border border-border-strong bg-popover px-3 py-2 text-xs shadow-lg">
            <p className="text-[10px] text-muted-foreground">
                {formatBucketPoint(point, locale)}
            </p>
            <p className="mt-1 flex items-baseline justify-between gap-3 tabular-nums">
                <span className="text-muted-foreground">
                    {t(`rightSidebar.usage.chartMetrics.${metric}`)}
                </span>
                <span className="font-medium text-foreground">
                    {formatMetricValue(point.value, metric, locale)}
                </span>
            </p>
        </div>
    );
}

function UsageRequestRow({
    request,
    locale,
    labels,
    editable,
    onEdit
}: {
    request: UsageRequest;
    locale: string;
    labels: UsageLabels;
    editable: boolean;
    onEdit: () => void;
}) {
    const { t } = useTranslation();
    const modelName = labels.modelNames.get(
        usageModelKey(request.provider, request.model)
    ) ?? (request.model || labels.unknownModel);
    const providerName = labels.providerNames.get(request.provider)
        ?? (request.provider || labels.unknownProvider);
    const sessionName = labels.sessionNames.get(request.sessionId)
        ?? (request.sessionId || labels.unknownAgent);
    const speed = request.generationMs > 0
        ? request.outputTokens / (request.generationMs / 1_000)
        : request.tokensPerSecond;
    return (
        <article className="px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    outcomeDotClass(request.outcome)
                }`} />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-[11px] font-medium text-foreground">
                            {modelName}
                        </p>
                        <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[9px] text-muted-foreground">
                            {t(`rightSidebar.usage.kinds.${request.turnKind}`)}
                        </span>
                        {request.retries > 0 ? (
                            <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
                                {t("rightSidebar.usage.retryCount", {
                                    count: request.retries
                                })}
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                        {providerName}
                        <span aria-hidden="true"> · </span>
                        {sessionName}
                    </p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                    <div className="text-right">
                        <p className="text-[11px] font-medium tabular-nums text-foreground">
                            {formatCost(request.costUsd, locale)}
                        </p>
                        <p className="mt-0.5 text-[9px] tabular-nums text-muted-foreground">
                            {formatRequestTime(request.startedAtMs, locale)}
                        </p>
                    </div>
                    {editable ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("rightSidebar.usage.editPrice")}
                            title={t("rightSidebar.usage.editPrice")}
                            onClick={onEdit}
                            className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground"
                        >
                            <Pencil />
                        </Button>
                    ) : null}
                </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5 text-[9px] text-muted-foreground">
                <span className={outcomeTextClass(request.outcome)}>
                    {t(`rightSidebar.usage.outcomes.${request.outcome}`)}
                </span>
                <span>
                    {t("rightSidebar.usage.requestTokens", {
                        input: formatCompact(request.inputTokens, locale),
                        output: formatCompact(request.outputTokens, locale),
                        cache: formatCompact(
                            request.cacheReadTokens + request.cacheWriteTokens,
                            locale
                        )
                    })}
                </span>
                {speed > 0 ? (
                    <span>
                        {t("rightSidebar.usage.summary.speed", {
                            value: formatCompact(speed, locale)
                        })}
                    </span>
                ) : null}
                {request.ttftMs > 0 ? (
                    <span>
                        {t("rightSidebar.usage.summary.firstToken", {
                            value: formatSeconds(request.ttftMs, locale)
                        })}
                    </span>
                ) : null}
                <span>
                    {formatDuration(request.durationMs, locale)}
                </span>
                {request.httpAttempts > 1 ? (
                    <span>
                        {t("rightSidebar.usage.attemptCount", {
                            count: request.httpAttempts
                        })}
                    </span>
                ) : null}
                {request.errorCode ? (
                    <span className="text-destructive">
                        {request.errorCode}
                    </span>
                ) : null}
            </div>
        </article>
    );
}

function DateInput({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <input
            type="date"
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-6 w-[6.6rem] bg-transparent px-0.5 text-[10px] text-foreground outline-none"
        />
    );
}

function formatInteger(value: number, locale: string): string {
    return new Intl.NumberFormat(locale).format(value);
}

function formatCompact(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1
    }).format(value);
}

function formatCost(value: number, locale: string): string {
    const digits = value > 0 && value < 1 ? 4 : 2;
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    }).format(value);
}

function formatPercent(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
}

function formatSeconds(ms: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: ms < 10_000 ? 1 : 0,
        maximumFractionDigits: ms < 10_000 ? 1 : 0
    }).format(ms / 1_000) + "s";
}

function formatDuration(ms: number, locale: string): string {
    if (ms < 1_000) {
        return tDurationMilliseconds(ms, locale);
    }
    return formatSeconds(ms, locale);
}

function tDurationMilliseconds(ms: number, locale: string): string {
    return `${new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0
    }).format(ms)}ms`;
}

function formatMetricValue(
    value: number,
    metric: UsageMetric,
    locale: string
): string {
    switch (metric) {
        case "tokens":
        case "traffic":
            return formatCompact(value, locale);
        case "cost":
            return formatCost(value, locale);
        case "requests":
            return formatInteger(value, locale);
        case "speed":
            return `${formatCompact(value, locale)}/s`;
    }
}

function formatAxisValue(
    value: number,
    metric: UsageMetric,
    locale: string
): string {
    if (metric === "cost") {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            notation: "compact",
            maximumFractionDigits: 1
        }).format(value);
    }
    return formatCompact(value, locale);
}

function formatRequestTime(ms: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(ms));
}

function formatBucketPoint(point: UsageChartPoint, locale: string): string {
    return formatBucketTooltip({
        startMs: point.startMs,
        endMs: point.endMs,
        label: point.label,
        grain: point.grain
    }, locale);
}

function outcomeDotClass(outcome: UsageRequest["outcome"]): string {
    switch (outcome) {
        case "completed":
            return "bg-success";
        case "error":
            return "bg-destructive";
        case "aborted":
            return "bg-warning";
    }
}

function outcomeTextClass(outcome: UsageRequest["outcome"]): string {
    switch (outcome) {
        case "completed":
            return "text-success";
        case "error":
            return "text-destructive";
        case "aborted":
            return "text-warning";
    }
}

function dateInputValue(dayOffset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function startOfDateInput(value: string): number {
    const [year, month, day] = value.split("-").map(Number);
    if (
        year === undefined
        || month === undefined
        || day === undefined
        || !Number.isFinite(year)
        || !Number.isFinite(month)
        || !Number.isFinite(day)
    ) {
        return Number.NaN;
    }
    return new Date(year, month - 1, day).getTime();
}

function addLocalDays(ms: number, days: number): number {
    const date = new Date(ms);
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + days
    ).getTime();
}

const EMPTY_REQUESTS: UsageRequest[] = [];
