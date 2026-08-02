"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings, User as UserIcon, Moon } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { ROLE_LABEL } from "@/lib/permissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { initials, cn } from "@/lib/utils";

export function UserMenu({ collapsed }: { collapsed?: boolean }) {
  const { user, signOut } = useAuth();
  const { profile } = useHotel();
  const { role, can } = usePermissions();
  const router = useRouter();
  if (!user) return null;

  const name = profile?.displayName ?? user.email ?? "Account";
  const email = user.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-overlay",
          collapsed && "justify-center px-0"
        )}
      >
        <Avatar>
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink-primary">{name}</span>
            <span className="block truncate text-[11px] text-ink-tertiary">
              {role ? ROLE_LABEL[role] : email}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuItem><UserIcon className="h-4 w-4" /> Profile</DropdownMenuItem>
        {can("settings") && (
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <Settings className="h-4 w-4" /> Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem><Moon className="h-4 w-4" /> Dark theme</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
