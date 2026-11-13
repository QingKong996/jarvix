import { MessageSquare, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixSessionSummary } from "../../../protocol/session.ts";

type SidebarProps = {
    sessions: JarvixSessionSummary[];
    activeSessionId: string | null;
    busy: boolean;
    onSelectSession(sessionId: string): void;
    onNewSession(): void;
    onOpenSettings(): void;
};

function navItemClass(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

function sessionItemClass(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

export function Sidebar({
    sessions,
    activeSessionId,
    busy,
    onSelectSession,
    onNewSession,
    onOpenSettings
}: SidebarProps) {
    const { t } = useTranslation();

    return (
        <aside className="flex h-full min-h-0 flex-col bg-secondary/20">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <span className="text-[15px] font-semibold tracking-[0.4px]">Jarvix</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3">
                <button
                    type="button"
                    onClick={onNewSession}
                    disabled={busy}
                    className={navItemClass(false)}
                >
                    <Plus className="size-4" />
                    {t("sessions.new")}
                </button>

                <p className="mt-5 px-3 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    {t("sessions.title")}
                </p>

                <nav
                    aria-label={t("sessions.title")}
                    className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
                >
                    {sessions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">{t("sessions.empty")}</p>
                    ) : sessions.map((session) => {
                        const active = session.id === activeSessionId;
                        return (
                            <button
                                key={session.id}
                                type="button"
                                aria-current={active ? "page" : undefined}
                                title={session.name}
                                onClick={() => onSelectSession(session.id)}
                                disabled={busy}
                                className={sessionItemClass(active)}
                            >
                                <MessageSquare className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{session.name}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>

            <div className="border-t border-border p-3">
                <button type="button" onClick={onOpenSettings} className={navItemClass(false)}>
                    <Settings className="size-4" />
                    {t("nav.settings")}
                </button>
            </div>
        </aside>
    );
}
