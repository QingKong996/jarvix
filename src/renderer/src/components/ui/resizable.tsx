import * as ResizablePrimitive from "react-resizable-panels"
import { cn } from "cn"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border transition-colors outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        "data-[separator=hover]:bg-border-strong data-[separator=focus]:bg-foreground/35 data-[separator=active]:bg-foreground/45",
        "focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:inset-y-auto aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        className
      )}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
