import type { ReactNode } from "react";
import { cn } from "cn";

type FormFieldProps = {
    label: string;
    children: ReactNode;
    className?: string;
};

export function FormField({ label, children, className }: FormFieldProps) {
    return (
        <label className={cn("flex flex-col gap-2 text-sm font-medium", className)}>
            <span>{label}</span>
            {children}
        </label>
    );
}
