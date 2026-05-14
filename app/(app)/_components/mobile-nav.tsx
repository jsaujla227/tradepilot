"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/_actions/auth";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/orders", label: "Orders" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/suggestions", label: "Suggestions" },
  { href: "/risk", label: "Risk" },
  { href: "/journal", label: "Journal" },
  { href: "/ai", label: "AI" },
];

export function MobileNav({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Sticky top bar — mobile only */}
      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <Link
          href={email ? "/dashboard" : "/"}
          onClick={() => setOpen(false)}
          className="text-sm font-semibold tracking-tight"
        >
          TradePilot
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition"
        >
          {open ? (
            /* X icon */
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="2" x2="14" y2="14" />
              <line x1="14" y1="2" x2="2" y2="14" />
            </svg>
          ) : (
            /* Hamburger */
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
          )}
        </button>
      </header>

      {/* Overlay drawer — mobile only */}
      {open && (
        <div className="md:hidden fixed inset-0 z-30 flex flex-col bg-background pt-14">
          <nav className="flex flex-col gap-0.5 px-4 py-4">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-3 py-2.5 text-sm transition ${
                    active
                      ? "bg-foreground/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-border/60 px-4 py-4 space-y-3">
            {email && (
              <>
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="block text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Settings
                </Link>
                <p className="text-xs text-muted-foreground/60 truncate">{email}</p>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="text-xs text-muted-foreground hover:text-destructive transition"
                  >
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
