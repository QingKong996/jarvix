import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { cn } from "cn"
import { quickTransition } from "../../motion.ts"

const DropdownMenuOpenContext = React.createContext(false)

function DropdownMenu({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )

  return (
    <DropdownMenuOpenContext.Provider value={open}>
      <DropdownMenuPrimitive.Root
        data-slot="dropdown-menu"
        open={controlledOpen}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DropdownMenuOpenContext.Provider>
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const open = React.useContext(DropdownMenuOpenContext)

  return (
    <DropdownMenuPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          <DropdownMenuPrimitive.Content
            asChild
            forceMount
            data-slot="dropdown-menu-content"
            sideOffset={sideOffset}
            {...props}
          >
            <motion.div
              className={cn(
                "bg-popover text-popover-foreground border-border-strong z-50 min-w-[10.5rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-xl border p-1.5 shadow-[0_6px_20px_rgb(0_0_0/0.06)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.36)]",
                className
              )}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={quickTransition}
            >
              {children}
            </motion.div>
          </DropdownMenuPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        "px-2.5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
}
