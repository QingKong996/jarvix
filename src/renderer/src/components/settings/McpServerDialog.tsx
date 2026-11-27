import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
    MCP_SERVER_TRANSPORTS,
    type JarvixMcpServerConfig,
    type McpServerTransport
} from "../../../../protocol/config.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { FormField } from "../common/FormField.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "../ui/select.tsx";
import { Switch } from "../ui/switch.tsx";
import { Textarea } from "../ui/textarea.tsx";

type McpServerDialogProps = {
    name?: string;
    config?: JarvixMcpServerConfig;
    serverNames: readonly string[];
    onClose: () => void;
    onSave: (name: string, config: JarvixMcpServerConfig) => void;
};

type ParsedPairs = {
    values?: Record<string, string>;
    line?: number;
};

export function McpServerDialog({
    name: initialName,
    config,
    serverNames,
    onClose,
    onSave
}: McpServerDialogProps) {
    const { t } = useTranslation();
    const formId = useId();
    const [name, setName] = useState(initialName ?? "");
    const [transport, setTransport] = useState<McpServerTransport>(
        config?.transport ?? (config?.command ? "stdio" : "http")
    );
    const [enabled, setEnabled] = useState(config?.enabled !== false);
    const [command, setCommand] = useState(config?.command ?? "");
    const [args, setArgs] = useState((config?.args ?? []).join("\n"));
    const [cwd, setCwd] = useState(config?.cwd ?? "");
    const [env, setEnv] = useState(formatPairs(config?.env));
    const [url, setUrl] = useState(config?.url ?? "");
    const [headers, setHeaders] = useState(formatPairs(config?.headers));
    const [error, setError] = useState("");

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const nextName = name.trim();
        if (nextName.length === 0) {
            setError(t("settings.mcp.nameRequired"));
            return;
        }
        if (serverNames.some((candidate) => (
            candidate !== initialName && candidate === nextName
        ))) {
            setError(t("settings.mcp.nameDuplicate"));
            return;
        }

        if (transport === "stdio") {
            const nextCommand = command.trim();
            if (nextCommand.length === 0) {
                setError(t("settings.mcp.commandRequired"));
                return;
            }
            const parsedEnv = parsePairs(env);
            if (parsedEnv.line !== undefined) {
                setError(t("settings.mcp.invalidPairs", {
                    field: t("settings.mcp.env"),
                    line: parsedEnv.line
                }));
                return;
            }
            const nextArgs = args
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            const nextCwd = cwd.trim();
            onSave(nextName, {
                transport,
                enabled,
                command: nextCommand,
                ...(nextArgs.length > 0 ? { args: nextArgs } : {}),
                ...(nextCwd.length > 0 ? { cwd: nextCwd } : {}),
                ...(parsedEnv.values && Object.keys(parsedEnv.values).length > 0
                    ? { env: parsedEnv.values }
                    : {})
            });
            return;
        }

        const nextUrl = url.trim();
        if (!isValidUrl(nextUrl)) {
            setError(t("settings.mcp.urlRequired"));
            return;
        }
        const parsedHeaders = parsePairs(headers);
        if (parsedHeaders.line !== undefined) {
            setError(t("settings.mcp.invalidPairs", {
                field: t("settings.mcp.headers"),
                line: parsedHeaders.line
            }));
            return;
        }
        onSave(nextName, {
            transport,
            enabled,
            url: nextUrl,
            ...(parsedHeaders.values && Object.keys(parsedHeaders.values).length > 0
                ? { headers: parsedHeaders.values }
                : {})
        });
    }

    return (
        <Dialog open onOpenChange={(open) => {
            if (!open) {
                onClose();
            }
        }}>
            <DialogContent
                aria-describedby={undefined}
                className="gap-0 overflow-hidden p-0 sm:max-w-xl"
            >
                <DialogHeader className="flex h-14 justify-center border-b border-border px-6">
                    <DialogTitle>
                        {t(initialName === undefined
                            ? "settings.mcp.addTitle"
                            : "settings.mcp.editTitle")}
                    </DialogTitle>
                </DialogHeader>

                <form
                    id={formId}
                    noValidate
                    onSubmit={handleSubmit}
                    className="flex max-h-[clamp(20rem,68dvh,36rem)] flex-col gap-4 overflow-y-auto p-6 text-sm"
                >
                    <FormField label={t("settings.mcp.name")}>
                        <Input
                            autoFocus
                            required
                            value={name}
                            placeholder={t("settings.mcp.namePlaceholder")}
                            onChange={(event) => {
                                setName(event.target.value);
                                setError("");
                            }}
                        />
                    </FormField>

                    <div className="flex items-center justify-between gap-4">
                        <span className="font-medium text-foreground">
                            {t("settings.mcp.transport")}
                        </span>
                        <Select
                            value={transport}
                            onValueChange={(value) => {
                                if (isTransport(value)) {
                                    setTransport(value);
                                    setError("");
                                }
                            }}
                        >
                            <SelectTrigger
                                aria-label={t("settings.mcp.transport")}
                                className="w-52"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MCP_SERVER_TRANSPORTS.map((item) => (
                                    <SelectItem key={item} value={item}>
                                        {t(`settings.mcp.transports.${item}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="font-medium text-foreground">
                                {t("settings.mcp.enabled")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {t("settings.mcp.enabledDescription")}
                            </p>
                        </div>
                        <Switch
                            checked={enabled}
                            aria-label={t("settings.mcp.enabled")}
                            onCheckedChange={setEnabled}
                        />
                    </div>

                    {transport === "stdio" ? (
                        <>
                            <FormField label={t("settings.mcp.command")}>
                                <Input
                                    required
                                    value={command}
                                    placeholder={t("settings.mcp.commandPlaceholder")}
                                    onChange={(event) => {
                                        setCommand(event.target.value);
                                        setError("");
                                    }}
                                />
                            </FormField>
                            <FormField label={t("settings.mcp.args")}>
                                <Textarea
                                    value={args}
                                    spellCheck={false}
                                    placeholder={t("settings.mcp.argsPlaceholder")}
                                    className="min-h-24 font-mono text-xs"
                                    onChange={(event) => {
                                        setArgs(event.target.value);
                                        setError("");
                                    }}
                                />
                                <span className="text-xs font-normal text-muted-foreground">
                                    {t("settings.mcp.argsDescription")}
                                </span>
                            </FormField>
                            <FormField label={t("settings.mcp.cwd")}>
                                <Input
                                    value={cwd}
                                    placeholder={t("settings.mcp.optional")}
                                    onChange={(event) => {
                                        setCwd(event.target.value);
                                        setError("");
                                    }}
                                />
                            </FormField>
                            <FormField label={t("settings.mcp.env")}>
                                <Textarea
                                    value={env}
                                    spellCheck={false}
                                    placeholder={t("settings.mcp.envPlaceholder")}
                                    className="min-h-20 font-mono text-xs"
                                    onChange={(event) => {
                                        setEnv(event.target.value);
                                        setError("");
                                    }}
                                />
                                <span className="text-xs font-normal text-muted-foreground">
                                    {t("settings.mcp.envDescription")}
                                </span>
                            </FormField>
                        </>
                    ) : (
                        <>
                            <FormField label={t("settings.mcp.url")}>
                                <Input
                                    required
                                    type="url"
                                    value={url}
                                    placeholder={t("settings.mcp.urlPlaceholder")}
                                    onChange={(event) => {
                                        setUrl(event.target.value);
                                        setError("");
                                    }}
                                />
                            </FormField>
                            <FormField label={t("settings.mcp.headers")}>
                                <Textarea
                                    value={headers}
                                    spellCheck={false}
                                    placeholder={t("settings.mcp.headersPlaceholder")}
                                    className="min-h-20 font-mono text-xs"
                                    onChange={(event) => {
                                        setHeaders(event.target.value);
                                        setError("");
                                    }}
                                />
                                <span className="text-xs font-normal text-muted-foreground">
                                    {t("settings.mcp.headersDescription")}
                                </span>
                            </FormField>
                        </>
                    )}
                </form>

                <DialogFooter
                    error={error}
                    className="gap-2.5 border-t border-border bg-sidebar/50 px-6 py-3.5"
                >
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t("settings.cancel")}
                    </Button>
                    <Button type="submit" form={formId}>
                        {t("settings.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function isTransport(value: string): value is McpServerTransport {
    return MCP_SERVER_TRANSPORTS.some((item) => item === value);
}

function isValidUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function formatPairs(values: Readonly<Record<string, string>> | undefined): string {
    return Object.entries(values ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
}

function parsePairs(value: string): ParsedPairs {
    const values: Record<string, string> = {};
    const lines = value.split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim();
        if (line.length === 0) {
            continue;
        }
        const separator = line.indexOf("=");
        if (separator <= 0) {
            return { line: index + 1 };
        }
        const key = line.slice(0, separator).trim();
        if (key.length === 0) {
            return { line: index + 1 };
        }
        values[key] = line.slice(separator + 1).trim();
    }
    return { values };
}
