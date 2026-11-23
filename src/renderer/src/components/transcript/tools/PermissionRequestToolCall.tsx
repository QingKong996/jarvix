import { useState } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { PermissionRequestView } from "../../../../../runtime/tools/view.ts";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { PermissionResourceList } from "../../permissions/PermissionResourceList.tsx";

export function PermissionRequestToolCall({
    data,
    isError
}: {
    data: PermissionRequestView;
    isError: boolean;
}) {
    const { t } = useTranslation();
    const pending = data.decision === "pending";
    const [open, setOpen] = useState(pending);

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            data-slot="permission-request-tool"
            data-decision={data.decision}
            className="flex flex-col gap-1.5"
        >
            <CollapsibleTrigger
                type="button"
                className="group -ml-5 flex w-fit items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <span className={cn(pending && "animate-pulse")}>
                    {t("permissionRequest.title")}
                </span>
                <span aria-hidden="true">·</span>
                <span>{statusLabel(data.decision, isError, t)}</span>
            </CollapsibleTrigger>

            <CollapsibleContent>
                <div className="flex flex-col gap-2 border-l-2 pl-3">
                    <p className="text-xs text-muted-foreground">
                        {t("permissionRequest.description")}
                    </p>
                    <PermissionResourceList
                        domains={data.domains}
                        directories={data.directories}
                    />
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function statusLabel(
    decision: PermissionRequestView["decision"],
    isError: boolean,
    t: TFunction<"translation">
): string {
    if (isError) {
        return t("tools.status.failed");
    }
    switch (decision) {
        case "pending":
            return t("permissionRequest.status.pending");
        case "approved":
            return t("permissionRequest.status.approved");
        case "cancelled":
            return t("permissionRequest.status.cancelled");
    }
}
