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
                "bg-popover text-popover-foreground z-50 min-w-[10rem] origin-[var(--radix-context-menu-content-transform-origin)] overflow-hidden rounded-lg border p-1 shadow-md",
                className
              )}
              initial={{ opacity: 0, scale: 0.97, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 2 }}
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
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
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
