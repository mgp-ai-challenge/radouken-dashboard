"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, LayoutList, BarChart3, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-[#e8eaed] bg-white"
      aria-label="Main navigation"
    >
      <nav className="flex flex-col gap-0.5 p-3" role="navigation">
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
                isActive
                  ? "bg-[#e8f0fe] text-[#1a73e8]"
                  : "text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
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
    </aside>
  )
}
