import { useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { cn } from "cn";
import type { JarvixContextUsage } from "../../../../protocol/context-usage.ts";
import { smoothTransition } from "../../motion.ts";

type ContextUsageRingProps = {
    usage: JarvixContextUsage | null;
};

const RADIUS = 8.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextUsageRing({ usage }: ContextUsageRingProps) {
    const { t, i18n } = useTranslation();
    const initialOffset = useRef<number | null>(null);
    const limit = usage?.contextWindow;
    if (!usage || !limit || limit <= 0) {
        return null;
    }

    const ratio = usage.estimatedTokens / limit;
    const percentage = ratio * 100;
    const roundedPercentage = Math.round(percentage);
    const numberFormat = new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: 0
    });
    const titlePercent = ratio > 0 && ratio < 0.01
        ? "<1"
        : String(roundedPercentage);
    const label = t("composer.contextUsage.label", {
        used: numberFormat.format(usage.estimatedTokens),
        limit: numberFormat.format(limit),
        percent: titlePercent
    });
    const percentLabel = ratio > 1
        ? "100"
        : titlePercent;
    const tone = percentage >= 90
        ? "text-destructive"
        : percentage >= 70
            ? "text-warning"
            : "text-foreground/70";
    const strokeDashoffset = CIRCUMFERENCE * (1 - Math.min(1, ratio));
    const initialStrokeDashoffset = initialOffset.current ?? strokeDashoffset;
    initialOffset.current = initialStrokeDashoffset;

    return (
        <motion.span
            role="img"
            aria-label={label}
            title={label}
            className="inline-flex size-8 shrink-0 items-center justify-center"
            style={{ "--ring-offset": initialStrokeDashoffset } as CSSProperties}
            animate={{ "--ring-offset": strokeDashoffset }}
            transition={smoothTransition}
        >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7">
                <circle
                    cx="12"
                    cy="12"
                    r={RADIUS}
                    fill="none"
                    strokeWidth="2.25"
                    className="stroke-border"
                />
                <circle
                    cx="12"
                    cy="12"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset="var(--ring-offset)"
                    transform="rotate(-90 12 12)"
                    className={tone}
                />
                <text
                    x="12"
                    y="12"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="7"
                    fontWeight="600"
                    className="fill-muted-foreground"
                >
                    {percentLabel}
                </text>
            </svg>
        </motion.span>
    );
}
