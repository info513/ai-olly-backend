"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { HotelSwitcher } from "./hotel-switcher";
import { UserMenu } from "./user-menu";
import { usePermissions } from "@/providers/permission-provider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aiolly.sidebar.collapsed";

export function AppSidebar() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const [collapsed, setCollapsed] = React.useState(false);

  // Permission-aware navigation: modules the role can't access are HIDDEN, not disabled.
  const items = NAV_ITEMS.filter((item) => can(item.href.replace(/^\//, "")));

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border-subtle bg-surface-base transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[248px]"
      )}
    >
      {/* Brand + collapse */}
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        {!collapsed && (
          <Link href="/home" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-cream font-display text-sm font-semibold text-brand-navyDeep">
              O
            </span>
            <span className="font-display text-[15px] tracking-tight text-ink-primary">AI OLLY</span>
          </Link>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary",
            collapsed && "ml-0"
          )}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Hotel switcher */}
      <div className="px-3 pb-2">
        <HotelSwitcher collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-brand-navy/60 text-ink-primary"
                  : "text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-cream" />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {!item.ready && (
                    <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary">
                      soon
                    </span>
                  )}
                </>
              )}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      {/* Account */}
      <div className="border-t border-border-subtle p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
