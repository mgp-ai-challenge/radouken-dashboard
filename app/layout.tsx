import { Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AppSidebar } from "@/components/app-sidebar"
import { cn } from "@/lib/utils"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", inter.variable, "font-sans")}
    >
      <body className="min-h-svh bg-[#f8f9fa]">
        <ThemeProvider>
          <div className="flex h-svh">
            <AppSidebar />
            <main className="min-h-0 flex-1 p-8">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
