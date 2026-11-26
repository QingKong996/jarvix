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
                "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/25 [&_svg]:size-4 [&_svg]:shrink-0",
                active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                className
            )}
            {...props}
        >
            {icon}
            {children}
        </button>
    );
}
