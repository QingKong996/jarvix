import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
    JarvixMcpServerConfig,
    McpServerTransport
} from "../../../../protocol/config.ts";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import { McpServerDialog } from "./McpServerDialog.tsx";

type McpSettingsProps = {
    servers: Readonly<Record<string, JarvixMcpServerConfig>>;
    disabled: boolean;
    onChange: (servers: Record<string, JarvixMcpServerConfig>) => void;
};

type McpServerEditor =
    | { kind: "new" }
    | { kind: "edit"; name: string };

export function McpSettings({
    servers,
    disabled,
    onChange
}: McpSettingsProps) {
    const { t } = useTranslation();
    const [editor, setEditor] = useState<McpServerEditor>();
    const entries = Object.entries(servers);
    const editing = editor?.kind === "edit"
        ? { name: editor.name, config: servers[editor.name] }
        : undefined;

    function save(name: string, config: JarvixMcpServerConfig): void {
        onChange(applyMcpServerSave(
            servers,
            editing?.name,
            name,
            config
        ));
        setEditor(undefined);
    }

    function setEnabled(name: string, enabled: boolean): void {
        const config = servers[name];
        if (!config) {
            return;
        }
        onChange({
            ...servers,
            [name]: { ...config, enabled }
        });
    }

    function remove(name: string): void {
        const next = { ...servers };
        delete next[name];
        onChange(next);
    }

    return (
        <section aria-labelledby="mcp-servers-title" className="flex flex-col gap-4 text-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 id="mcp-servers-title" className="font-medium text-foreground">
                        {t("settings.mcp.title")}
                    </h3>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                        {t("settings.mcp.description")}
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => setEditor({ kind: "new" })}
                >
                    <Plus />
                    {t("settings.mcp.add")}
                </Button>
            </div>

            {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-surface-subtle/60 px-4 py-8 text-center text-xs text-muted-foreground">
                    {t("settings.mcp.empty")}
                </div>
            ) : (
                <ul className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-background">
                    {entries.map(([name, config]) => {
                        const enabled = config.enabled !== false;
                        const transport = config.transport
                            ?? (config.command ? "stdio" : "http");
                        return (
                            <li key={name} className="flex items-center gap-3 px-3.5 py-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                                    <Server className="size-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium text-foreground">
                                            {name}
                                        </span>
                                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {t(`settings.mcp.transports.${transport}`)}
                                        </span>
                                    </div>
                                    <p
                                        className="mt-1 truncate text-xs text-muted-foreground"
                                        title={serverTarget(config, transport)}
                                    >
                                        {serverTarget(config, transport)}
                                    </p>
                                </div>
                                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                                    <Switch
                                        checked={enabled}
                                        disabled={disabled}
                                        aria-label={t("settings.mcp.toggleNamed", { name })}
                                        onCheckedChange={(checked) => setEnabled(name, checked)}
                                    />
                                    {t("settings.mcp.enabled")}
                                </label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={t("settings.mcp.editNamed", { name })}
                                    onClick={() => setEditor({ kind: "edit", name })}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <Pencil />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={t("settings.mcp.removeNamed", { name })}
                                    onClick={() => remove(name)}
                                    className="text-muted-foreground hover:text-destructive"
                                >
                                    <Trash2 />
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {editor ? (
                <McpServerDialog
                    key={editing?.name ?? "new"}
                    name={editing?.name}
                    config={editing?.config}
                    serverNames={entries.map(([name]) => name)}
                    onClose={() => setEditor(undefined)}
                    onSave={save}
                />
            ) : null}
        </section>
    );
}

export function applyMcpServerSave(
    servers: Readonly<Record<string, JarvixMcpServerConfig>>,
    originalName: string | undefined,
    name: string,
    config: JarvixMcpServerConfig
): Record<string, JarvixMcpServerConfig> {
    const next: Record<string, JarvixMcpServerConfig> = {};
    let replaced = false;
    for (const [key, value] of Object.entries(servers)) {
        if (key === originalName) {
            next[name] = config;
            replaced = true;
        } else {
            next[key] = value;
        }
    }
    if (!replaced) {
        next[name] = config;
    }
    return next;
}

function serverTarget(
    config: JarvixMcpServerConfig,
    transport: McpServerTransport
): string {
    if (transport === "stdio") {
        return [config.command, ...(config.args ?? [])]
            .filter((part): part is string => Boolean(part))
            .join(" ");
    }
    return config.url ?? "";
}
