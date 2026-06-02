"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw, Star } from "lucide-react"
import { cn, shellNavLink } from "@/lib/utils"
import { useState } from "react"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/self-serve", label: "Self-Serve", icon: TrendingUp },
  { href: "/g2", label: "G2", icon: Star },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export function AppSidebar() {
  const pathname = usePathname()
  const [restarting, setRestarting] = useState(false)

  async function handleRestart() {
    setRestarting(true)
    try {
      await fetch("/api/dev/restart", { method: "POST" })
    } catch {
      // Expected — server exits mid-response
    }
    // Wait for server to come back, then reload
    await new Promise((r) => setTimeout(r, 5000))
    window.location.reload()
  }

  return (
    <aside
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="Main navigation"
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-3" role="navigation">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? shellNavLink.active : shellNavLink.inactive,
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                className="size-5 shrink-0 stroke-[1.5]"
                aria-hidden
              />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={handleRestart}
          disabled={restarting}
          className={cn(
            "flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
            shellNavLink.inactive,
            restarting && "opacity-50 cursor-not-allowed"
          )}
        >
          <RotateCcw
            className={cn("size-5 shrink-0 stroke-[1.5]", restarting && "animate-spin")}
            aria-hidden
          />
          <span>{restarting ? "Restarting…" : "Restart Server"}</span>
        </button>
      </div>
    </aside>
  )
}
