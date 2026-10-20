"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp,
  RotateCcw, Star, BarChart2, Target, FileText, Zap, Filter, ChevronDown,
} from "lucide-react"
import { cn, shellNavLink } from "@/lib/utils"
import { useState } from "react"

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard }
type NavGroup = { label: string; icon: typeof LayoutDashboard; basePath: string; children: NavItem[] }
type NavEntry = NavItem | NavGroup

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry
}

const navItems: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/self-serve", label: "Self-Serve", icon: TrendingUp },
  { href: "/g2", label: "G2", icon: Star },
  { href: "/blog-attribution", label: "Blog Attribution", icon: FileText },
  {
    label: "Funnel",
    icon: Filter,
    basePath: "/funnel",
    children: [
      { href: "/funnel/mql", label: "MQLs", icon: Zap },
    ],
  },
  { href: "/campaigns", label: "Campaigns", icon: BarChart2 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/icp-sourcing", label: "UA Sourcing", icon: Target },
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [restarting, setRestarting] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // Auto-open groups whose children match the current path
    const open = new Set<string>()
    for (const entry of navItems) {
      if (isGroup(entry) && pathname.startsWith(entry.basePath)) {
        open.add(entry.basePath)
      }
    }
    return open
  })

  function toggleGroup(basePath: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(basePath)) next.delete(basePath)
      else next.add(basePath)
      return next
    })
  }

  async function handleRestart() {
    setRestarting(true)
    try {
      await fetch("/api/dev/restart", { method: "POST" })
    } catch {
      // Expected — server exits mid-response
    }
    await new Promise((r) => setTimeout(r, 5000))
    window.location.reload()
  }

  return (
    <aside
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="Main navigation"
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-3" role="navigation">
        {navItems.map((entry) => {
          if (isGroup(entry)) {
            const isOpen = openGroups.has(entry.basePath)
            const isActive = pathname.startsWith(entry.basePath)
            const Icon = entry.icon

            return (
              <div key={entry.basePath}>
                <button
                  onClick={() => toggleGroup(entry.basePath)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? shellNavLink.active : shellNavLink.inactive,
                  )}
                >
                  <Icon className="size-5 shrink-0 stroke-[1.5]" aria-hidden />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 stroke-[1.5] transition-transform duration-200",
                      isOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {isOpen && (
                  <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
                    {entry.children.map(({ href, label, icon: ChildIcon }) => {
                      const childActive = pathname.startsWith(href)
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={cn(
                            "flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                            childActive ? shellNavLink.active : shellNavLink.inactive,
                          )}
                          aria-current={childActive ? "page" : undefined}
                        >
                          <ChildIcon className="size-4 shrink-0 stroke-[1.5]" aria-hidden />
                          <span>{label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          const { href, label, icon: Icon } = entry
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
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
              <Icon className="size-5 shrink-0 stroke-[1.5]" aria-hidden />
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
