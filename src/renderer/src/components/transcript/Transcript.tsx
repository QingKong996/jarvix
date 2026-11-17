import { memo, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { useCommitted, useInjected, useLive } from "./transcript-hooks.ts";
import { subscribeCommitted, subscribeInjected, subscribeLive } from "./transcript-store.ts";
import type { CommittedTurn, LiveTurn } from "./types.ts";
import { CHAT_COLUMN, CONTENT_GUTTER } from "../../layout.ts";
import { Markdown } from "./Markdown.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCallBlock } from "./tools/ToolCallBlock.tsx";

const CommittedTurnView = memo(function CommittedTurnView({ turn }: { turn: CommittedTurn }) {
    const { t } = useTranslation();

    if (turn.role === "user") {
        return (
            <p className="max-w-[85%] self-end rounded-lg bg-secondary px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-secondary-foreground">
                {turn.text}
            </p>
        );
    }
    if (turn.role === "system") {
        return <ThinkingBlock text={turn.text} label={t("system.message")} />;
    }

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {turn.blocks.map((block, index) => {
                if (block.type === "thinking") {
                    return <ThinkingBlock key={index} text={block.thinking} />;
                }
                if (block.type === "tool") {
                    return (
                        <ToolCallBlock
                            key={block.toolCallId}
                            toolName={block.toolName}
                            data={block.data}
                            isError={block.isError}
                            endReason={block.endReason}
                        />
                    );
                }
                return <Markdown key={index} text={block.text} />;
            })}
            {turn.error ? <p role="alert" className="text-[13px] text-destructive">{turn.error}</p> : null}
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

function InjectedList() {
    const injected = useInjected();
    return (
        <>
            {injected.map((turn) => (
                <CommittedTurnView key={turn.id} turn={turn} />
            ))}
        </>
    );
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
        const unsubscribeInjected = subscribeInjected(scrollToBottom);
        return () => {
            container.removeEventListener("scroll", updateFollow);
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
            unsubscribeCommitted();
            unsubscribeLive();
            unsubscribeInjected();
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
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
            <div className={cn("flex min-h-full flex-col gap-3 py-8", CONTENT_GUTTER)}>
                <div className={cn("flex flex-col gap-3", CHAT_COLUMN)}>
                    <CommittedList />
                    <LiveSlot />
                    <InjectedList />
                </div>
            </div>
        </section>
    );
}
