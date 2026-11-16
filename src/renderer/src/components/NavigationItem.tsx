import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

type NavigationItemProps = ComponentProps<"button"> & {
    active?: boolean;
    icon?: ReactNode;
};

export function NavigationItem({
    active = false,
    icon,
    className,
    children,
    type = "button",
    ...props
}: NavigationItemProps) {
    return (
        <button
            type={type}
            className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
                active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                className
            )}
            {...props}
        >
            {icon}
            {children}
        </button>
    );
}
