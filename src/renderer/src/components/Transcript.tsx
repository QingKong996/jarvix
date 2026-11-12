import { memo, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useCommitted, useLive } from "../transcript-hooks.ts";
import { subscribeCommitted, subscribeLive } from "../transcript-store.ts";
import type { CommittedTurn, LiveTurn } from "../types.ts";
import { Markdown } from "./Markdown.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

const CommittedTurnView = memo(function CommittedTurnView({ turn }: { turn: CommittedTurn }) {
    if (turn.role === "user") {
        return (
            <p className="max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-primary-foreground">
                {turn.text}
            </p>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {turn.blocks.map((block, index) => block.type === "thinking" ? (
                <ThinkingBlock key={index} text={block.thinking} />
            ) : (
                <Markdown key={index} text={block.text} />
            ))}
            {turn.error ? <p className="text-[13px] text-destructive">{turn.error}</p> : null}
        </div>
    );
});

function CommittedList() {
    const committed = useCommitted();
    return (
        <>
            {committed.map((turn) => (
                <CommittedTurnView key={turn.id} turn={turn} />
            ))}
        </>
    );
}

function LiveTurnView({ turn }: { turn: LiveTurn }) {
    const { t } = useTranslation();
    const hasText = turn.blocks.some((block) => block.kind === "text" && block.text.length > 0);
    const lastIndex = turn.blocks.at(-1)?.index;

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {turn.blocks.map((block) => block.kind === "thinking" ? (
                <ThinkingBlock key={block.index} text={block.text} streaming={block.index === lastIndex} />
            ) : (
                <Markdown key={block.index} text={block.text} streaming={block.index === lastIndex} />
            ))}
            {hasText ? null : <p className="animate-pulse text-[13px] text-muted-foreground">{t("transcript.generating")}</p>}
        </div>
    );
}

function LiveSlot() {
    const live = useLive();
    return live ? <LiveTurnView turn={live} /> : null;
}

const FOLLOW_THRESHOLD_PX = 80;

function useFollowBottom(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const container = ref.current;
        if (!container) {
            return;
        }
        let frame: number | null = null;
        let follow = true;
        let autoScrollTop = 0;

        const updateFollow = (): void => {
            // Ignore scroll events caused by our own auto-scroll so streaming growth never disables following.
            if (Math.abs(container.scrollTop - autoScrollTop) <= 1) {
                return;
            }
            follow = container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_THRESHOLD_PX;
        };

        const scrollToBottom = (): void => {
            if (frame !== null) {
                return;
            }
            frame = requestAnimationFrame(() => {
                frame = null;
                if (!follow) {
                    return;
                }
                container.scrollTop = container.scrollHeight;
                autoScrollTop = container.scrollTop;
            });
        };

        container.addEventListener("scroll", updateFollow, { passive: true });
        const unsubscribeCommitted = subscribeCommitted(scrollToBottom);
        const unsubscribeLive = subscribeLive(scrollToBottom);
        return () => {
            container.removeEventListener("scroll", updateFollow);
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
            unsubscribeCommitted();
            unsubscribeLive();
        };
    }, [ref]);
}

export function Transcript({ sessionId }: { sessionId: string | null }) {
    const containerRef = useRef<HTMLElement>(null);
    useFollowBottom(containerRef);

    return (
        <section
            ref={containerRef}
            data-session-id={sessionId ?? undefined}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-14 py-8"
        >
            <CommittedList />
            <LiveSlot />
        </section>
    );
}
