import { useEffect, useState } from "react";
import { Pause, Pencil, Play, Target, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { JarvixGoal } from "../../../../protocol/session.ts";
import { Button } from "../ui/button.tsx";

type GoalCardProps = {
    goal: JarvixGoal;
    running: boolean;
    disabled: boolean;
    editDisabled: boolean;
    onDelete(): void;
    onPause(): void;
    onResume(): void;
    onEdit(): void;
};

export function GoalCard({
    goal,
    running,
    disabled,
    editDisabled,
    onDelete,
    onPause,
    onResume,
    onEdit
}: GoalCardProps) {
    const { t } = useTranslation();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div
            data-testid="goal-card"
            data-running={running ? "true" : "false"}
            className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border",
                "bg-card/80 px-2.5 py-1.5 text-card-foreground shadow-sm"
            )}
        >
            <Target aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-xs font-medium">
                {running ? t("composer.goal.running") : t("composer.goal.paused")}
            </span>
            <span
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                title={goal.content}
            >
                {goal.content}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatDuration(now - goal.createdAt)}
            </span>
            <div className="flex shrink-0 items-center">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("composer.goal.delete")}
                    title={t("composer.goal.delete")}
                    disabled={disabled}
                    onClick={onDelete}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                    <Trash2 />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={running ? t("composer.goal.pause") : t("composer.goal.resume")}
                    title={running ? t("composer.goal.pause") : t("composer.goal.resume")}
                    disabled={disabled && !running}
                    onClick={running ? onPause : onResume}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                    {running ? <Pause /> : <Play />}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("composer.goal.edit")}
                    title={t("composer.goal.edit")}
                    disabled={disabled || editDisabled}
                    onClick={onEdit}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                    <Pencil />
                </Button>
            </div>
        </div>
    );
}

function formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}
