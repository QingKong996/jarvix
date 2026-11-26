import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "cn"

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>
  viewportClassName?: string
}

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "focus-visible:ring-ring/30 size-full rounded-[inherit] transition-colors outline-none focus-visible:ring-2",
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-border-strong/70 hover:bg-muted-foreground/50 relative flex-1 rounded-full transition-colors"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea }
