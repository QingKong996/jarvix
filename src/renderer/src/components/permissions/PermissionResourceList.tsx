import type { ReactNode } from "react";
import { Folder, Globe2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
    PermissionAccess,
    PermissionAction,
    PermissionDirectoryChange,
    PermissionDomainChange
} from "../../../../protocol/permission.ts";

type PermissionResourceListProps = {
    domains: readonly PermissionDomainChange[];
    directories: readonly PermissionDirectoryChange[];
};

type ResourceItem = {
    action: PermissionAction;
    access?: PermissionAccess;
    value: string;
};

export function PermissionResourceList({
    domains,
    directories
}: PermissionResourceListProps) {
    const { t } = useTranslation();
    if (domains.length === 0 && directories.length === 0) {
        return null;
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            {domains.length > 0 ? (
                <ResourceGroup
                    icon={<Globe2 aria-hidden="true" />}
                    label={t("permissionRequest.domains")}
                    items={domains.map((change) => ({
                        action: change.action,
                        value: change.domain
                    }))}
                />
            ) : null}
            {directories.length > 0 ? (
                <ResourceGroup
                    icon={<Folder aria-hidden="true" />}
                    label={t("permissionRequest.directories")}
                    items={directories.map((change) => ({
                        action: change.action,
                        access: change.access,
                        value: change.path
                    }))}
                />
            ) : null}
        </div>
    );
}

function ResourceGroup({
    icon,
    label,
    items
}: {
    icon: ReactNode;
    label: string;
    items: readonly ResourceItem[];
}) {
    const { t } = useTranslation();
    return (
        <section className="min-w-0">
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <span className="[&>svg]:size-3.5 [&>svg]:text-muted-foreground">{icon}</span>
                {label}
            </h4>
            <ul className="max-h-28 overflow-y-auto rounded-xl border border-border/80 bg-background px-2.5 py-1.5">
                {items.map((item) => (
                    <li
                        key={`${item.action}:${item.access ?? ""}:${item.value}`}
                        className="flex min-w-0 items-start gap-1.5 py-0.5"
                    >
                        <span className="mt-px shrink-0 rounded-full border border-border/70 bg-muted px-2 text-[10px] leading-4 font-medium text-muted-foreground">
                            {t(`permissionRequest.action.${item.action}`)}
                        </span>
                        {item.access ? (
                            <span className="mt-px shrink-0 rounded-full border border-border/70 bg-muted px-2 text-[10px] leading-4 font-medium text-muted-foreground">
                                {t(`permissionRequest.access.${item.access}`)}
                            </span>
                        ) : null}
                        <span className="min-w-0 break-all font-mono text-xs leading-relaxed text-muted-foreground">
                            {item.value}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
