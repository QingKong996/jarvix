import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { cn } from "cn"
import { quickTransition } from "../../motion.ts"

const ContextMenuOpenContext = React.createContext(false)

function ContextMenu({
  open: controlledOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )

  return (
    <ContextMenuOpenContext.Provider value={open}>
      <ContextMenuPrimitive.Root
        data-slot="context-menu"
        open={controlledOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </ContextMenuOpenContext.Provider>
  )
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const open = React.useContext(ContextMenuOpenContext)

  return (
    <ContextMenuPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          <ContextMenuPrimitive.Content
            asChild
            forceMount
            data-slot="context-menu-content"
            {...props}
          >
            <motion.div
              className={cn(
                "bg-popover text-popover-foreground border-border-strong z-50 min-w-[10.5rem] origin-[var(--radix-context-menu-content-transform-origin)] overflow-hidden rounded-xl border p-1.5 shadow-[0_6px_20px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.36)]",
                className
              )}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={quickTransition}
            >
              {children}
            </motion.div>
          </ContextMenuPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem
}
