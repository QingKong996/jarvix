import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

    return (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t px-14 py-3">
            <Input
                type="text"
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="输入问题..."
                className="flex-1"
            />
            <Button type="submit" disabled={disabled || value.trim().length === 0}>
                <Send />
                发送
            </Button>
        </form>
    );
}
