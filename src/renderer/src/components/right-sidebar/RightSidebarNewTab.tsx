import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    RIGHT_SIDEBAR_PANELS,
    type RightSidebarPanel
} from "./panel-registry.ts";

type RightSidebarNewTabProps = {
    onOpenPanel(panel: RightSidebarPanel): void;
};

export function RightSidebarNewTab({ onOpenPanel }: RightSidebarNewTabProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const options = useMemo(
        () => RIGHT_SIDEBAR_PANELS.filter((option) => (
            normalizedQuery.length === 0 ||
            t(option.labelKey).toLocaleLowerCase().includes(normalizedQuery)
        )),
        [normalizedQuery, t]
    );

    return (
        <section
            data-testid="right-sidebar-new-tab"
            className="flex h-full min-h-0 flex-col overflow-y-auto bg-background px-5 py-6"
        >
            <div className="mx-auto my-auto w-full max-w-88">
                <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="search"
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label={t("rightSidebar.search")}
                        placeholder={t("rightSidebar.searchPlaceholder")}
                        data-testid="right-sidebar-new-tab-search"
                        className="h-10 w-full rounded-xl border border-input bg-background pr-3.5 pl-10 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-border-strong focus:border-foreground/40 focus:ring-2 focus:ring-ring/20"
                    />
                </div>

                <div className="mt-7 flex items-center justify-between">
                    <h3 className="text-xs font-medium text-muted-foreground">
                        {t("rightSidebar.newSection")}
                    </h3>
                </div>

                {options.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        {options.map((option) => {
                            const Icon = option.icon;
                            return (
                                <button
                                    key={option.panel}
                                    type="button"
                                    onClick={() => onOpenPanel(option.panel)}
                                    data-testid={`right-sidebar-new-tab-${option.panel}`}
                                    className="flex h-26 flex-col items-start justify-between rounded-xl border border-border bg-surface-subtle p-4 text-left text-foreground transition-colors duration-150 outline-none hover:border-border-strong hover:bg-accent/70 focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/20"
                                >
                                    <Icon className="size-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">
                                        {t(option.labelKey)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                        {t("rightSidebar.noMatches")}
                    </p>
                )}
            </div>
        </section>
    );
}
