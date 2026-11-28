import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JarvixContextUsage } from "../../../../protocol/context-usage.ts";
import type { JarvixProviderContext } from "../../../../protocol/provider-context.ts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContextMessage } from "./ContextMessage.tsx";
import { contextMessagesFor } from "./context-messages.ts";
import { PerspectiveContextPanel } from "./PerspectiveContextPanel.tsx";
import { PerspectiveTimingPanel } from "./PerspectiveTimingPanel.tsx";
import { perspectiveTimingFor } from "./perspective-timing.ts";

type ContextInspectorProps = {
    sessionId: string | null;
    providerContextRevision: number;
    contextUsage: JarvixContextUsage | null;
};

export function ContextInspector({
    sessionId,
    providerContextRevision,
    contextUsage
}: ContextInspectorProps) {
    const { t } = useTranslation();
    const [context, setContext] = useState<JarvixProviderContext | null>(null);
    const [failed, setFailed] = useState(false);
    const requestIdRef = useRef(0);
    const loadedSessionIdRef = useRef<string | null>(null);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const sessionChanged = loadedSessionIdRef.current !== sessionId;
        loadedSessionIdRef.current = sessionId;
        if (sessionChanged) {
            setContext(null);
            setFailed(false);
        }
        if (!sessionId) {
            return;
        }

        void window.jarvix.getProviderContext(sessionId)
            .then((next) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setContext(next);
                setFailed(false);
            })
            .catch(() => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setContext(null);
                setFailed(true);
            });
    }, [providerContextRevision, sessionId]);

    const entries = useMemo(
        () => context ? contextMessagesFor(context) : [],
        [context]
    );
    const timing = useMemo(
        () => context ? perspectiveTimingFor(context.messages) : null,
        [context]
    );

    if (!context) {
        const title = failed
            ? t("rightSidebar.context.failedTitle")
            : sessionId
                ? t("rightSidebar.context.loadingTitle")
                : t("rightSidebar.context.emptyTitle");
        const description = failed
            ? t("rightSidebar.context.failedDescription")
            : sessionId
                ? t("rightSidebar.context.loadingDescription")
                : t("rightSidebar.context.emptyDescription");

        return (
            <div
                data-testid="context-inspector-empty"
                className="flex h-full items-center justify-center bg-background px-8 text-center"
            >
                <div className="flex max-w-64 flex-col gap-1.5">
                    <p className="text-sm font-medium text-foreground">
                        {title}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <section
            data-testid="context-inspector"
            className="flex h-full min-h-0 flex-col bg-background text-foreground"
        >
            <PerspectiveContextPanel
                usage={contextUsage}
                history={context.usageHistory ?? []}
                breakdown={context.breakdown}
            />
            {timing ? <PerspectiveTimingPanel timing={timing} /> : null}
            <ScrollArea
                className="min-h-0 flex-1"
                viewportClassName="[&>div]:!block"
            >
                <div
                    data-testid="context-inspector-messages"
                    className="flex flex-col"
                >
                    {entries.map((entry, index) => (
                        <ContextMessage
                            key={`${entry.kind}-${index}`}
                            entry={entry}
                        />
                    ))}
                </div>
            </ScrollArea>
        </section>
    );
}
