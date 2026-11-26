import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/20",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
