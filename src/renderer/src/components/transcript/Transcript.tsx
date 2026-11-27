import {
    memo,
    useLayoutEffect,
    useRef,
    type RefObject
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { useCommitted, useInjected, useLive } from "./state/transcript-hooks.ts";
import type { CommittedTurn, LiveTurn } from "./state/types.ts";
import { CHAT_COLUMN, CONTENT_GUTTER } from "../../layout.ts";
import { Markdown } from "./Markdown.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCallBlock } from "./tools/ToolCallBlock.tsx";
import { quickTransition } from "../../motion.ts";

const TRANSCRIPT_GAP_PX = 24;
const VIRTUALIZATION_ENABLED = typeof window !== "undefined"
    && typeof window.ResizeObserver === "function";

type TranscriptEntry =
    | {
        kind: "committed";
        turn: CommittedTurn;
    } | {
        kind: "live";
        turn: LiveTurn;
    } | {
        kind: "injected";
        turn: CommittedTurn;
    };

type TranscriptData = {
    committed: readonly CommittedTurn[];
    live: LiveTurn | null;
    injected: readonly CommittedTurn[];
};

const CommittedTurnView = memo(function CommittedTurnView({ turn }: { turn: CommittedTurn }) {
    const { t } = useTranslation();

    if (turn.role === "user") {
        return (
            <p className="max-w-[82%] self-end rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-secondary-foreground">
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
            {turn.error ? (
                <p
                    role="alert"
                    className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
                >
                    {turn.error}
                </p>
            ) : null}
        </div>
    );
});

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

const TranscriptEntryView = memo(
    function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
        if (entry.kind === "live") {
            return (
                <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={quickTransition}
                >
                    <LiveTurnView turn={entry.turn} />
                </motion.div>
            );
        }
        const turn = entry.turn;
        return (
            <div className={turn.role === "user" ? "flex justify-end" : "min-w-0"}>
                <CommittedTurnView turn={turn} />
            </div>
        );
    },
    (previous, next) => (
        previous.entry.kind === next.entry.kind
        && previous.entry.turn === next.entry.turn
    )
);

function transcriptEntryKey(entry: TranscriptEntry): string {
    return entry.turn.id;
}

function transcriptEntryCount({
    committed,
    live,
    injected
}: TranscriptData): number {
    return committed.length + (live ? 1 : 0) + injected.length;
}

function transcriptEntryAt(data: TranscriptData, index: number): TranscriptEntry {
    if (index < data.committed.length) {
        return {
            kind: "committed",
            turn: data.committed[index]!
        };
    }
    if (data.live && index === data.committed.length) {
        return {
            kind: "live",
            turn: data.live
        };
    }
    return {
        kind: "injected",
        turn: data.injected[index - data.committed.length - (data.live ? 1 : 0)]!
    };
}

function estimateTranscriptEntrySize(entry: TranscriptEntry): number {
    if (entry.kind === "live") {
        return 240;
    }
    if (entry.turn.role === "user") {
        return 64;
    }
    if (entry.turn.role === "system") {
        return 112;
    }
    return 200;
}

function StaticTranscript({ data }: { data: TranscriptData }) {
    const count = transcriptEntryCount(data);
    return (
        <div className={cn("py-8", CONTENT_GUTTER)}>
            <div className={cn("flex flex-col gap-6", CHAT_COLUMN)}>
                {Array.from({ length: count }, (_, index) => {
                    const entry = transcriptEntryAt(data, index);
                    return (
                        <TranscriptEntryView
                            key={transcriptEntryKey(entry)}
                            entry={entry}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function VirtualizedTranscript({
    data,
    sessionId,
    scrollRef
}: {
    data: TranscriptData;
    sessionId: string | null;
    scrollRef: RefObject<HTMLElement | null>;
}) {
    const count = transcriptEntryCount(data);
    const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => estimateTranscriptEntrySize(
            transcriptEntryAt(data, index)
        ),
        getItemKey: (index) => transcriptEntryKey(
            transcriptEntryAt(data, index)
        ),
        paddingStart: 32,
        paddingEnd: 32,
        gap: TRANSCRIPT_GAP_PX,
        overscan: 4,
        anchorTo: "end",
        followOnAppend: true,
        scrollEndThreshold: 80
    });
    const previousSessionId = useRef<string | null | undefined>(undefined);

    useLayoutEffect(() => {
        if (previousSessionId.current === sessionId) {
            return;
        }
        previousSessionId.current = sessionId;
        if (count > 0) {
            virtualizer.scrollToEnd();
        }
    }, [count, sessionId, virtualizer]);

    return (
        <div className={CONTENT_GUTTER}>
            <div
                className={cn("relative", CHAT_COLUMN)}
                style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const entry = transcriptEntryAt(data, virtualItem.index);
                    return (
                        <div
                            key={virtualItem.key}
                            ref={virtualizer.measureElement}
                            data-index={virtualItem.index}
                            className="absolute inset-x-0 top-0"
                            style={{
                                transform: `translate3d(0, ${virtualItem.start}px, 0)`
                            }}
                        >
                            <TranscriptEntryView entry={entry} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function Transcript({ sessionId }: { sessionId: string | null }) {
    const containerRef = useRef<HTMLElement>(null);
    const committed = useCommitted();
    const live = useLive();
    const injected = useInjected();
    const data = { committed, live, injected };

    return (
        <section
            ref={containerRef}
            data-session-id={sessionId ?? undefined}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            style={{ overflowAnchor: "none" }}
        >
            {VIRTUALIZATION_ENABLED ? (
                <VirtualizedTranscript
                    data={data}
                    sessionId={sessionId}
                    scrollRef={containerRef}
                />
            ) : (
                <StaticTranscript data={data} />
            )}
        </section>
    );
}
