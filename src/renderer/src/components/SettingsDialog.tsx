import { useEffect, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

function SettingsForm({ config, onSaved }: SettingsFormProps) {
    const [value, setValue] = useState(config?.apiKey ?? "");
    const [revealed, setRevealed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (config && !saved) {
            setValue(config.apiKey ?? "");
        }
    }, [config, saved]);

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
            setValue(next.apiKey ?? "");
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-sm">
                <label htmlFor="settings-api-key" className="font-medium">
                    DeepSeek API Key
                </label>
                <div className="relative">
                    <Input
                        id="settings-api-key"
                        type={revealed ? "text" : "password"}
                        autoComplete="off"
                        placeholder="sk-..."
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            setSaved(false);
                            setError(null);
                        }}
                        className="pr-10"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={revealed ? "隐藏 API Key" : "显示 API Key"}
                        onClick={() => setRevealed((current) => !current)}
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                    >
                        {revealed ? <EyeOff /> : <Eye />}
                    </Button>
                </div>
            </div>

            <div className="flex items-center justify-end gap-3">
                {saved ? <span className="text-xs text-muted-foreground">已保存</span> : null}
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                <Button type="submit" disabled={!bridge || saving}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
                    保存
                </Button>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        取消
                    </Button>
                </DialogClose>
            </div>
        </form>
    );
}
