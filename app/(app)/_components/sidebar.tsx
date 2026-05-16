"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/_actions/auth";

type NavItem = {
  href: string;
  label: string;
  milestone: string | null;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", milestone: "M4" },
  { href: "/portfolio", label: "Portfolio", milestone: "M4" },
  { href: "/orders", label: "Orders", milestone: "M6" },
  { href: "/watchlist", label: "Watchlist", milestone: "M8" },
  { href: "/suggestions", label: "Suggestions", milestone: null },
  { href: "/backtest", label: "Backtest", milestone: null },
  { href: "/risk", label: "Risk", milestone: null },
  { href: "/journal", label: "Journal", milestone: "M9" },
  { href: "/ai", label: "AI", milestone: "M10" },
  { href: "/admin", label: "Admin", milestone: null },
];

export function Sidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card/30 px-4 py-6">
      <Link href={email ? "/dashboard" : "/"} className="mb-8 px-2 block">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <div aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
          <span>Private</span>
        </div>
        <span className="mt-1 block text-base font-semibold tracking-tight text-foreground">
          TradePilot
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition ${
                active
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <span>{item.label}</span>
              {item.milestone ? (
                <span className="text-[10px] font-mono text-muted-foreground/60">
                  {item.milestone}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border/60 pt-4 px-2 space-y-2">
        {email ? (
          <>
            <p
              className="text-[11px] text-muted-foreground truncate"
              title={email}
            >
              {email}
            </p>
            <Link
              href="/settings"
              className={`block text-xs transition ${
                pathname.startsWith("/settings")
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-muted-foreground hover:text-destructive-foreground transition"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/login"
            className="block text-xs font-medium text-foreground hover:text-foreground/80 transition"
          >
            Sign in →
          </Link>
        )}
      </div>
    </aside>
  );
}
