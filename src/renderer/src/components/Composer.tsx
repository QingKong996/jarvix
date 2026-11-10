import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ComposerProps = {
    disabled: boolean;
    onSubmit: (question: string) => void;
};

export function Composer({ disabled, onSubmit }: ComposerProps) {
    const [value, setValue] = useState("");

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const question = value.trim();
        if (!question || disabled) {
            return;
        }
        setValue("");
        onSubmit(question);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) {
            return;
        }

        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    }

    return (
        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t px-14 py-3">
            <Textarea
                rows={1}
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入问题..."
                className="max-h-48 min-h-9 flex-1 resize-none"
            />
            <Button type="submit" size="icon" aria-label="发送" disabled={disabled || value.trim().length === 0}>
                <Send />
            </Button>
        </form>
    );
}
