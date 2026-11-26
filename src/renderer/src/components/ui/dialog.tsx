import * as React from "react"
import { XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "cn"
import { quickTransition } from "../../motion.ts"

const DialogOpenContext = React.createContext(false)

function Dialog({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
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
    <DialogOpenContext.Provider value={open}>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={controlledOpen}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DialogOpenContext.Provider>
  )
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      asChild
      forceMount
      {...props}
    >
      <motion.div
        data-slot="dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-black/40 dark:bg-black/60",
          className
        )}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={quickTransition}
      />
    </DialogPrimitive.Overlay>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  contentRef,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  contentRef?: React.Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()
  const open = React.useContext(DialogOpenContext)

  return (
    <DialogPrimitive.Portal data-slot="dialog-portal" forceMount>
      <AnimatePresence>
        {open ? <DialogOverlay key="overlay" /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Content
            key="content"
            asChild
            forceMount
            {...props}
          >
            <motion.div
              ref={contentRef}
              data-slot="dialog-content"
              className={cn(
                "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border border-border-strong bg-card p-6 shadow-[0_12px_36px_rgb(0_0_0/0.09)] dark:shadow-[0_16px_40px_rgb(0_0_0/0.45)] sm:max-w-md",
                className
              )}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={quickTransition}
            >
              {children}
              {showCloseButton ? (
                <DialogPrimitive.Close
                  data-slot="dialog-close"
                  data-testid="dialog-close"
                  className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none"
                >
                  <XIcon className="size-4" />
                  <span className="sr-only">{t("ui.dialog.close")}</span>
                </DialogPrimitive.Close>
              ) : null}
            </motion.div>
          </DialogPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-9", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-snug font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
}
