import type { ReactNode } from "react";
import { cn } from "cn";

type DialogFooterProps = {
    children: ReactNode;
    error?: string | null;
    className?: string;
};

export function DialogFooter({ children, error, className }: DialogFooterProps) {
    return (
        <div className={cn("flex items-center justify-end gap-2", className)}>
            {error ? (
                <p role="alert" className="mr-auto text-xs text-destructive">
                    {error}
                </p>
            ) : null}
            {children}
        </div>
    );
}
