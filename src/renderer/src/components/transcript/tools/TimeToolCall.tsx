import { useEffect, useState } from "react";
import { Clock3, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { LocalTimeView, SleepView } from "../../../../../runtime/tools/view.ts";

export function LocalTimeToolCall({ data }: { data: LocalTimeView }) {
    const { t } = useTranslation();
    const { date, time } = splitLocalTime(data.localTime);
    const available = data.status !== "pending" && time.length > 0;

    return (
        <div
            data-slot="local-time-tool"
            data-status={data.status}
            className="overflow-hidden rounded-xl border border-border/80 bg-surface-subtle"
        >
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                    <Clock3 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        {t("tools.localTime")}
                    </p>
                    <p className="font-mono text-xl leading-tight font-semibold text-foreground tabular-nums">
                        {available ? time : "--:--:--"}
                    </p>
                    <p className="min-h-4 text-xs text-muted-foreground">
                        {available ? date : null}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px]">
                    <span className="font-medium text-foreground">{data.timeZone || "—"}</span>
                    <span className="text-muted-foreground">
                        UTC{data.utcOffset || "—"}
                    </span>
                </div>
            </div>
            <div className="grid grid-cols-2 border-t border-border/80 bg-background/50">
                <Metric
                    label={t("tools.localTimeDetails.utcOffset")}
                    value={data.utcOffset || "—"}
                />
                <Metric
                    label={t("tools.localTimeDetails.unixTimestamp")}
                    value={data.epochMillis > 0 ? data.epochMillis.toLocaleString() : "—"}
                    divided
                />
            </div>
            <ToolError output={data.output} visible={data.status === "failed"} />
        </div>
    );
}

export function SleepToolCall({ data }: { data: SleepView }) {
    const { t } = useTranslation();
    const active = data.status === "pending" || data.status === "running";
    const remainingMs = useRemainingMs(data.startedAt, data.durationMs, active);
    const displayedMs = active
        ? remainingMs
        : clamp(data.elapsedMs, 0, data.durationMs);
    const label = active
        ? t("tools.sleepDetails.remaining")
        : data.status === "failed"
            ? `${t("tools.sleepDetails.interrupted")} · ${t("tools.sleepDetails.elapsed")}`
            : t("tools.sleepDetails.elapsed");

    return (
        <div
            data-slot="sleep-tool"
            data-status={data.status}
            className="overflow-hidden rounded-xl border border-border/80 bg-surface-subtle"
        >
            <div className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                    <Timer className={cn("size-4", active && "animate-pulse text-foreground")} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                    <p
                        role="timer"
                        className="font-mono text-xl leading-tight font-semibold tracking-tight text-foreground tabular-nums"
                    >
                        {formatClock(displayedMs)}
                    </p>
                </div>
            </div>
            <ToolError output={data.output} visible={data.status === "failed"} />
        </div>
    );
}

function Metric({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
    return (
        <div className={cn("min-w-0 px-3.5 py-2", divided && "border-l border-border")}>
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-foreground tabular-nums">{value}</p>
        </div>
    );
}

function ToolError({ output, visible }: { output: string; visible: boolean }) {
    if (!visible || output.length === 0) {
        return null;
    }
    return (
        <p className="border-t border-border px-3.5 py-2 text-xs leading-relaxed text-destructive">
            {output}
        </p>
    );
}

function useRemainingMs(startedAt: number, durationMs: number, active: boolean): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!active) {
            return;
        }
        const update = (): void => setNow(Date.now());
        update();
        const timer = window.setInterval(update, 100);
        return () => window.clearInterval(timer);
    }, [active, durationMs, startedAt]);

    return clamp(startedAt + durationMs - now, 0, durationMs);
}

function splitLocalTime(value: string): { date: string; time: string } {
    const [date = "", clock = ""] = value.split("T");
    return { date, time: clock.slice(0, 8) };
}

function formatClock(value: number): string {
    const totalSeconds = Math.ceil(clamp(value, 0, Number.MAX_SAFE_INTEGER) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}
