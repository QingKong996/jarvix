import { useState } from "react";
import { ArchiveRestore, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixSessionSummary } from "../../../../protocol/session.ts";
import { Button } from "../ui/button.tsx";

type ArchivedSettingsProps = {
    sessions: JarvixSessionSummary[];
    disabled: boolean;
    onRestore: (sessionId: string) => Promise<boolean>;
};

export function ArchivedSettings({ sessions, disabled, onRestore }: ArchivedSettingsProps) {
    const { t, i18n } = useTranslation();
    const [restoringId, setRestoringId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function restore(sessionId: string): Promise<void> {
        if (disabled || restoringId) {
            return;
        }
        setRestoringId(sessionId);
        setError(null);
        try {
            if (!await onRestore(sessionId)) {
                setError(t("settings.archived.restoreFailed"));
            }
        } catch {
            setError(t("settings.archived.restoreFailed"));
        } finally {
            setRestoringId(null);
        }
    }

    return (
        <section aria-labelledby="archived-sessions-title" className="flex flex-col gap-3 text-sm">
            <div>
                <h3 id="archived-sessions-title" className="font-medium">
                    {t("settings.archived.title")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.archived.description")}
                </p>
            </div>

            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

            {sessions.length > 0 ? (
                <ul className="divide-y rounded-md border">
                    {sessions.map((session) => (
                        <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="truncate" title={session.name}>{session.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {t("settings.archived.archivedAt", {
                                        date: new Date(session.archivedAt ?? session.updatedAt)
                                            .toLocaleString(i18n.language)
                                    })}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={disabled || restoringId !== null}
                                onClick={() => void restore(session.id)}
                            >
                                {restoringId === session.id
                                    ? <LoaderCircle className="animate-spin" />
                                    : <ArchiveRestore />}
                                {restoringId === session.id
                                    ? t("settings.archived.restoring")
                                    : t("settings.archived.restore")}
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
                    {t("settings.archived.empty")}
                </div>
            )}
        </section>
    );
}
