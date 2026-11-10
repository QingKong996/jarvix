import { memo, useEffect, useRef, type RefObject } from "react";
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
    const hasText = turn.blocks.some((block) => block.kind === "text" && block.text.length > 0);
    const lastIndex = turn.blocks.at(-1)?.index;

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {turn.blocks.map((block) => block.kind === "thinking" ? (
                <ThinkingBlock key={block.index} text={block.text} streaming={block.index === lastIndex} />
            ) : (
                <Markdown key={block.index} text={block.text} streaming={block.index === lastIndex} />
            ))}
            {hasText ? null : <p className="animate-pulse text-[13px] text-muted-foreground">生成中…</p>}
        </div>
    );
}

function LiveSlot() {
    const live = useLive();
    return live ? <LiveTurnView turn={live} /> : null;
}

function useFollowBottom(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const container = ref.current;
        if (!container) {
            return;
        }
        let frame: number | null = null;
        const follow = (): void => {
            if (frame !== null) {
                return;
            }
            frame = requestAnimationFrame(() => {
                frame = null;
                container.scrollTop = container.scrollHeight;
            });
        };
        const unsubscribeCommitted = subscribeCommitted(follow);
        const unsubscribeLive = subscribeLive(follow);
        return () => {
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
            unsubscribeCommitted();
            unsubscribeLive();
        };
    }, [ref]);
}

export function Transcript() {
    const containerRef = useRef<HTMLElement>(null);
    useFollowBottom(containerRef);

    return (
        <section ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-14 py-8">
            <CommittedList />
            <LiveSlot />
        </section>
    );
}
