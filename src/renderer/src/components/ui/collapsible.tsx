import * as React from "react"
import { motion } from "motion/react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { cn } from "cn"
import { smoothTransition } from "../../motion.ts"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

function AnimatedCollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent asChild {...props}>
      <motion.div
        data-slot="collapsible-content"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        transition={smoothTransition}
        className={cn("overflow-hidden", className)}
      >
        {children}
      </motion.div>
    </CollapsiblePrimitive.CollapsibleContent>
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  AnimatedCollapsibleContent
}
