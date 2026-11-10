import { useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { JarvixConfig } from "../../../protocol/config.ts";

type SettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: JarvixConfig | null;
    onSaved: (config: JarvixConfig) => void;
};

const bridge = window.jarvix;

export function SettingsDialog({ open, onOpenChange, config, onSaved }: SettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>设置</DialogTitle>
                    <DialogDescription>API Key 保存在 ~/.jarvix/config.json。</DialogDescription>
                </DialogHeader>
                <SettingsForm config={config} onSaved={onSaved} />
            </DialogContent>
        </Dialog>
    );
}

type SettingsFormProps = {
    config: JarvixConfig | null;
    onSaved: (config: JarvixConfig) => void;
};

function apiKeyPlaceholder(apiKey: string | undefined): string {
    if (!apiKey) {
        return "sk-...";
    }
    const masked = apiKey.length <= 8 ? "********" : `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
    return `已配置：${masked}（输入新 Key 可替换）`;
}

function SettingsForm({ config, onSaved }: SettingsFormProps) {
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || saving) {
            return;
        }
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const next = await bridge.setConfig({ apiKey: value });
            onSaved(next);
            setValue("");
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">DeepSeek API Key</span>
                <Input
                    type="password"
                    autoComplete="off"
                    placeholder={apiKeyPlaceholder(config?.apiKey)}
                    value={value}
                    onChange={(event) => {
                        setValue(event.target.value);
                        setSaved(false);
                        setError(null);
                    }}
                />
            </label>

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={!bridge || saving}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
                    保存
                </Button>
                {saved ? <span className="text-xs text-muted-foreground">已保存</span> : null}
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
            </div>

            <p className="text-xs text-muted-foreground">留空保存会清除已保存的 Key；保存后立即生效，无需重启。</p>
        </form>
    );
}
