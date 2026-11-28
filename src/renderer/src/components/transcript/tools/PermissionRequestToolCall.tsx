import { useEffect, useState } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import type { PermissionRequestView } from "../../../../../runtime/tools/view.ts";
import {
    Collapsible,
    AnimatedCollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { PermissionResourceList } from "../../permissions/PermissionResourceList.tsx";
import { quickTransition } from "../../../motion.ts";

export function PermissionRequestToolCall({
    data
}: {
    data: PermissionRequestView;
}) {
    const { t } = useTranslation();
    const pending = data.decision === "pending";
    const [open, setOpen] = useState(pending);

    useEffect(() => {
        if (!pending) {
            setOpen(false);
        }
    }, [pending]);

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
                className="group -ml-2 flex w-fit items-center gap-1.5 rounded-lg px-2 py-0 text-xs text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            >
                <motion.span
                    aria-hidden="true"
                    animate={{ rotate: open ? 90 : 0 }}
                    transition={quickTransition}
                    className="inline-flex shrink-0"
                >
                    <ChevronRight className="size-3.5" />
                </motion.span>
                <ShieldAlert aria-hidden="true" className={cn("size-3.5 shrink-0", pending && "text-warning")} />
                <span className={cn("font-medium", pending && "animate-pulse")}>
                    {t("permissionRequest.title")}
                </span>
                <span aria-hidden="true" className="opacity-50">·</span>
                <span
                    className={cn(
                        pending
                            ? "text-warning"
                            : "text-muted-foreground"
                    )}
                >
                    {statusLabel(data.decision, t)}
                </span>
            </CollapsibleTrigger>

            <AnimatedCollapsibleContent>
                <div className="ml-1.5 flex flex-col gap-2 border-l border-border pl-3.5">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("permissionRequest.description")}
                    </p>
                    <PermissionResourceList
                        domains={data.domains}
                        directories={data.directories}
                    />
                </div>
            </AnimatedCollapsibleContent>
        </Collapsible>
    );
}

function statusLabel(
    decision: PermissionRequestView["decision"],
    t: TFunction<"translation">
): string {
    switch (decision) {
        case "pending":
            return t("permissionRequest.status.pending");
        case "approved":
            return t("permissionRequest.status.approved");
        case "cancelled":
            return t("permissionRequest.status.cancelled");
    }
}
