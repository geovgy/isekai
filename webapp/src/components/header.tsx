'use client'

import { ConnectKitButton } from "connectkit"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/src/lib/utils"
import { Circle, Zap } from "lucide-react"

export function Header() {
  const pathname = usePathname()
  
  const navItems = [
    { href: "/assets", label: "Assets" },
    { href: "/market", label: "Market" },
    { href: "/wormholes", label: "Wormholes" },
  ]

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="glass mx-4 mt-4 rounded-2xl px-6 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            {/* <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-[#dc2626] transition-transform group-hover:scale-105">
              <Circle className="w-5 h-5 text-white" strokeWidth={3} />
              <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div> */}
            <Image
              src="/logo.png"
              alt="Isekai"
              width={50}
              height={50}
            />
            <div className="flex flex-col">
              <span className="text-lg font-bold text-[#0d9488]">Isekai</span>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-muted/50 rounded-full p-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-4 py-2 text-sm font-medium rounded-full transition-all duration-300",
                  pathname === item.href
                    ? "text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {pathname === item.href && (
                  <span className="absolute inset-0 rounded-full bg-[#0d9488]" />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <ConnectKitButton theme="soft" />
          </div>
        </div>
      </div>
    </header>
  )
}
