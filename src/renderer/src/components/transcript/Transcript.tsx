import {
    memo,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { useCommitted, useInjected, useLive } from "./state/transcript-hooks.ts";
import type { CommittedTurn, LiveTurn } from "./state/types.ts";
import { CHAT_COLUMN, CONTENT_GUTTER } from "../../layout.ts";
import { Markdown } from "./Markdown.tsx";
import { ProcessGroup, type ProcessGroupEntry } from "./ProcessGroup.tsx";

const TRANSCRIPT_GAP_PX = 12;
const VIRTUALIZATION_ENABLED = typeof window !== "undefined"
    && typeof window.ResizeObserver === "function";

type TranscriptData = {
    committed: readonly CommittedTurn[];
    live: LiveTurn | null;
    injected: readonly CommittedTurn[];
};

type TranscriptItem =
    | {
        kind: "process";
        key: string;
        entries: ProcessGroupEntry[];
    } | {
        kind: "user";
        key: string;
        text: string;
    } | {
        kind: "text";
        key: string;
        text: string;
        streaming: boolean;
    } | {
        kind: "error";
        key: string;
        error: string;
    } | {
        kind: "generating";
        key: string;
    };

function buildTranscriptItems({
    committed,
    live,
    injected
}: TranscriptData): TranscriptItem[] {
    const items: TranscriptItem[] = [];
    let processEntries: ProcessGroupEntry[] = [];

    const flushProcess = (): void => {
        const first = processEntries[0];
        if (!first) {
            return;
        }
        items.push({
            kind: "process",
            key: `process:${first.key}`,
            entries: processEntries
        });
        processEntries = [];
    };

    const pushUser = (turn: CommittedTurn): void => {
        flushProcess();
        items.push({
            kind: "user",
            key: `user:${turn.id}`,
            text: turn.text
        });
    };

    for (const turn of committed) {
        if (turn.role === "user") {
            pushUser(turn);
            continue;
        }
        if (turn.role === "system") {
            processEntries.push({
                kind: "system",
                key: `system:${turn.id}`,
                text: turn.text
            });
            continue;
        }

        for (const [index, block] of turn.blocks.entries()) {
            if (block.type === "thinking") {
                processEntries.push({
                    kind: "thinking",
                    key: `${turn.id}:block:${index}`,
                    text: block.thinking
                });
                continue;
            }
            if (block.type === "tool") {
                processEntries.push({
                    kind: "tool",
                    key: `tool:${block.toolCallId}`,
                    toolName: block.toolName,
                    data: block.data,
                    endReason: block.endReason
                });
                continue;
            }
            if (block.text.length === 0) {
                continue;
            }
            flushProcess();
            items.push({
                kind: "text",
                key: `text:${turn.id}:${index}`,
                text: block.text,
                streaming: false
            });
        }

        if (turn.error) {
            flushProcess();
            items.push({
                kind: "error",
                key: `error:${turn.id}`,
                error: turn.error
            });
        }
    }

    if (live) {
        const lastIndex = live.blocks.at(-1)?.index;
        const hasText = live.blocks.some((block) => (
            block.kind === "text" && block.text.length > 0
        ));

        for (const block of live.blocks) {
            if (block.kind === "thinking") {
                processEntries.push({
                    kind: "thinking",
                    key: `${live.id}:block:${block.index}`,
                    text: block.text,
                    streaming: block.index === lastIndex
                });
                continue;
            }
            if (block.text.length === 0) {
                continue;
            }
            flushProcess();
            items.push({
                kind: "text",
                key: `text:${live.id}:${block.index}`,
                text: block.text,
                streaming: block.index === lastIndex
            });
        }

        if (!hasText) {
            flushProcess();
            items.push({
                kind: "generating",
                key: `generating:${live.id}`
            });
        }
    }

    for (const turn of injected) {
        pushUser(turn);
    }
    flushProcess();
    return items;
}

function TranscriptItemView({
    item,
    concise
}: {
    item: TranscriptItem;
    concise: boolean;
}) {
    const { t } = useTranslation();

    switch (item.kind) {
        case "process":
            return (
                <ProcessGroup
                    entries={item.entries}
                    defaultOpen={!concise}
                />
            );
        case "user":
            return (
                <div className="flex justify-end">
                    <p className="max-w-[82%] self-end rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-secondary-foreground">
                        {item.text}
                    </p>
                </div>
            );
        case "text":
            return (
                <Markdown
                    text={item.text}
                    streaming={item.streaming}
                />
            );
        case "error":
            return (
                <p
                    role="alert"
                    className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
                >
                    {item.error}
                </p>
            );
        case "generating":
            return (
                <p className="animate-pulse text-[13px] text-muted-foreground">
                    {t("transcript.generating")}
                </p>
            );
    }
}

function estimateTranscriptItemSize(
    item: TranscriptItem,
    concise: boolean
): number {
    switch (item.kind) {
        case "process":
            return concise ? 28 : 160;
        case "user":
            return 64;
        case "text":
            return 200;
        case "error":
            return 72;
        case "generating":
            return 24;
    }
}

function StaticTranscript({
    items,
    concise
}: {
    items: readonly TranscriptItem[];
    concise: boolean;
}) {
    return (
        <div className={cn("py-8", CONTENT_GUTTER)}>
            <div className={cn("flex flex-col gap-3", CHAT_COLUMN)}>
                {items.map((item) => (
                    <TranscriptItemView
                        key={item.key}
                        item={item}
                        concise={concise}
                    />
                ))}
            </div>
        </div>
    );
}

function VirtualizedTranscript({
    items,
    sessionId,
    concise,
    scrollElement
}: {
    items: readonly TranscriptItem[];
    sessionId: string | null;
    concise: boolean;
    scrollElement: HTMLElement;
}) {
    const count = items.length;
    const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => estimateTranscriptItemSize(
            items[index]!,
            concise
        ),
        getItemKey: (index) => items[index]!.key,
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
                    const item = items[virtualItem.index]!;
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
                            <TranscriptItemView
                                item={item}
                                concise={concise}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export const Transcript = memo(function Transcript({
    sessionId,
    concise = false
}: {
    sessionId: string | null;
    concise?: boolean;
}) {
    const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
    const committed = useCommitted();
    const live = useLive();
    const injected = useInjected();
    const items = useMemo(() => buildTranscriptItems({
        committed,
        live,
        injected
    }), [committed, live, injected]);

    return (
        <section
            ref={setScrollElement}
            data-session-id={sessionId ?? undefined}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            style={{ overflowAnchor: "none" }}
        >
            {VIRTUALIZATION_ENABLED ? (
                scrollElement ? (
                    <VirtualizedTranscript
                        items={items}
                        sessionId={sessionId}
                        concise={concise}
                        scrollElement={scrollElement}
                    />
                ) : null
            ) : (
                <StaticTranscript items={items} concise={concise} />
            )}
        </section>
    );
});
