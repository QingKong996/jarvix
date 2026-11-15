import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LlmSystemNotice } from "../../../llm/types.ts";

export function BackgroundTaskNotice({ notice }: { notice: LlmSystemNotice }) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-[13px]">
            <div className="flex items-center gap-1.5 font-medium">
                <Terminal className="size-3.5 shrink-0" />
                <span>{t("backgroundTask.ended")}</span>
                <span aria-hidden="true">·</span>
                <span className="text-muted-foreground">
                    {notice.exitCode === null
                        ? t("backgroundTask.unknownExitCode")
                        : t("backgroundTask.exitCode", { code: notice.exitCode })}
                </span>
            </div>
            <code className="break-all text-[12px] text-muted-foreground">{notice.sessionId}</code>
            {notice.errorMessage ? <p className="text-[12px] text-destructive">{notice.errorMessage}</p> : null}
            <p className="text-[12px] text-muted-foreground">
                {t("backgroundTask.buffered", { count: notice.unreadCharacters })}
            </p>
        </div>
    );
}
