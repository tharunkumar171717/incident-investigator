"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { FolderGit2, History, LayoutDashboard, LogOut, Moon, Plus, Sun, Siren } from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/incidents/new", label: "New incident", icon: Plus, exact: true },
  { href: "/incidents", label: "Investigations", icon: History, exact: false },
  { href: "/repositories", label: "Repositories", icon: FolderGit2, exact: false },
];

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function Sidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href) && !(href === "/incidents" && pathname === "/incidents/new");

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-panel md:sticky md:top-0 md:h-screen md:w-56 md:border-r md:border-b-0">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg">
          <Siren className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Incident Investigator</div>
          <div className="text-[11px] text-subtle">AI root-cause analysis</div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:pb-0">
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
              isActive(href, exact) ? "bg-panel-2 font-medium text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="hidden border-t border-border p-3 md:block">
        <div className="mb-2 truncate text-xs text-muted" title={email ?? undefined}>
          {email ?? "Signed in"}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-panel-2 hover:text-fg" aria-label="Toggle theme">
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            {dark ? "Light" : "Dark"}
          </button>
          <form action="/auth/signout" method="post" className="ml-auto">
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-panel-2 hover:text-fg">
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
