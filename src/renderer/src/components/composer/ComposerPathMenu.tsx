import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "cn";
import type { JarvixPathCompletion } from "../../../../protocol/path-completion.ts";
import { CHAT_COLUMN } from "../../layout.ts";
import { quickTransition } from "../../motion.ts";
import { pathIcon } from "./path-icons.ts";

type ComposerPathMenuProps = {
    paths: readonly JarvixPathCompletion[];
    query: string;
    activeIndex: number;
    label: string;
    onActiveIndexChange(index: number): void;
    onSelect(path: JarvixPathCompletion): void;
};

export function ComposerPathMenu({
    paths,
    query,
    activeIndex,
    label,
    onActiveIndexChange,
    onSelect
}: ComposerPathMenuProps) {
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const activePath = paths[activeIndex]?.path;
    const nameQuery = querySegment(query);

    useEffect(() => {
        if (activePath) {
            optionRefs.current.get(activePath)?.scrollIntoView({ block: "nearest" });
        }
    }, [activePath]);

    return (
        <motion.div
            id="composer-path-menu"
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: 6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={quickTransition}
            className={cn(
                CHAT_COLUMN,
                "mb-2 overflow-hidden rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur-sm"
            )}
        >
            <div className="max-h-[min(24rem,50vh)] overflow-y-auto">
                {paths.map((path, index) => {
                    const Icon = pathIcon(path.kind, path.name);
                    const active = index === activeIndex;
                    return (
                        <button
                            key={path.path}
                            ref={(element) => {
                                if (element) {
                                    optionRefs.current.set(path.path, element);
                                } else {
                                    optionRefs.current.delete(path.path);
                                }
                            }}
                            id={`composer-path-${index}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => onActiveIndexChange(index)}
                            onClick={() => onSelect(path)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors",
                                active
                                    ? "border-border bg-accent text-accent-foreground"
                                    : "border-transparent hover:bg-accent/50"
                            )}
                        >
                            <Icon
                                aria-hidden="true"
                                className={cn(
                                    "size-4 shrink-0",
                                    active ? "text-foreground" : "text-muted-foreground"
                                )}
                            />
                            <span className="shrink-0 text-[13px] font-medium">
                                <HighlightedPath value={path.name} query={nameQuery} />
                            </span>
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                                <HighlightedPath
                                    value={path.relativePath}
                                    absoluteValue={path.path}
                                    query={query}
                                />
                            </span>
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
}

type PathSegment = {
    text: string;
    highlighted: boolean;
};

function HighlightedPath({
    value,
    absoluteValue,
    query
}: {
    value: string;
    absoluteValue?: string;
    query: string;
}) {
    return (
        <>
            {highlightSegments(value, query, absoluteValue).map((segment, index) => (
                segment.highlighted ? (
                    <mark
                        key={index}
                        className="rounded-[2px] bg-primary/20 px-0 text-inherit"
                    >
                        {segment.text}
                    </mark>
                ) : segment.text
            ))}
        </>
    );
}

function highlightSegments(
    value: string,
    query: string,
    absoluteValue?: string
): PathSegment[] {
    const match = pathMatch(value, query, absoluteValue);
    if (!match) {
        return [{ text: value, highlighted: false }];
    }

    const segments: PathSegment[] = [];
    if (match.start > 0) {
        segments.push({ text: value.slice(0, match.start), highlighted: false });
    }
    segments.push({
        text: value.slice(match.start, match.end),
        highlighted: true
    });
    if (match.end < value.length) {
        segments.push({ text: value.slice(match.end), highlighted: false });
    }
    return segments;
}

function pathMatch(
    value: string,
    query: string,
    absoluteValue?: string
): { start: number; end: number } | null {
    const absoluteMatch = isAbsolutePathQuery(query)
        && comparablePathText(absoluteValue ?? value)
            .startsWith(comparablePathText(query));
    const matchQuery = absoluteMatch ? query : relativeQueryText(query);

    const valueSegments = pathSegments(value);
    const querySegments = pathSegments(matchQuery);
    const requiresExactFinalSegment = /[\\/]$/u.test(matchQuery);
    let match: { start: number; end: number; segmentCount: number } | null = null;

    for (let queryStart = 0; queryStart < querySegments.length; queryStart += 1) {
        const remainingQuery = querySegments.slice(queryStart);
        for (
            let valueStart = 0;
            valueStart + remainingQuery.length <= valueSegments.length;
            valueStart += 1
        ) {
            const remainingValue = valueSegments.slice(
                valueStart,
                valueStart + remainingQuery.length
            );
            if (!segmentsMatch(remainingQuery, remainingValue, requiresExactFinalSegment)) {
                continue;
            }
            const finalQuerySegment = remainingQuery.at(-1)!;
            const candidate = {
                start: remainingValue[0]!.start,
                end: remainingValue.at(-1)!.start + finalQuerySegment.value.length,
                segmentCount: remainingQuery.length
            };
            if (
                !match
                || candidate.segmentCount > match.segmentCount
                || (
                    candidate.segmentCount === match.segmentCount
                    && candidate.start > match.start
                )
            ) {
                match = candidate;
            }
        }
    }

    if (!match) {
        return null;
    }
    if (requiresExactFinalSegment && /[\\/]/u.test(value[match.end] ?? "")) {
        match.end += 1;
    }
    return { start: match.start, end: match.end };
}

function querySegment(query: string): string {
    const normalized = comparablePathText(query);
    if (!normalized || normalized.endsWith("/")) {
        return "";
    }
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function comparablePathText(value: string): string {
    return value.replace(/\\/gu, "/").toLowerCase();
}

function isAbsolutePathQuery(query: string): boolean {
    return /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(query);
}

function relativeQueryText(query: string): string {
    let value = query.replace(/\\/gu, "/");
    while (true) {
        if (value.startsWith("./")) {
            value = value.slice(2);
            continue;
        }
        if (value === ".") {
            return "";
        }
        if (value.startsWith("/")) {
            value = value.slice(1);
            continue;
        }
        return value;
    }
}

type IndexedPathSegment = {
    value: string;
    start: number;
    end: number;
};

function pathSegments(value: string): IndexedPathSegment[] {
    const segments: IndexedPathSegment[] = [];
    let start = 0;
    for (let index = 0; index <= value.length; index += 1) {
        if (index < value.length && value[index] !== "/" && value[index] !== "\\") {
            continue;
        }
        if (index > start) {
            segments.push({
                value: comparablePathText(value.slice(start, index)),
                start,
                end: index
            });
        }
        start = index + 1;
    }
    return segments;
}

function segmentsMatch(
    query: readonly IndexedPathSegment[],
    value: readonly IndexedPathSegment[],
    exactFinalSegment: boolean
): boolean {
    return query.every((segment, index) => {
        const final = index === query.length - 1;
        const candidate = value[index]!.value;
        return final && !exactFinalSegment
            ? candidate.startsWith(segment.value)
            : candidate === segment.value;
    });
}
