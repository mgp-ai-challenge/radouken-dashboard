import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Matches left nav: soft blue active state, muted hover (Google-style shell). */
export const shellNavLink = {
  active: "bg-primary/10 text-primary",
  inactive: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const

export function shellFilterChip(active: boolean) {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary/20 bg-primary/10 text-primary"
      : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
  )
}
