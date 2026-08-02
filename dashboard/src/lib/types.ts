import type { Role } from "./permissions";

/** A hotel the current user belongs to, with the user's role at that hotel. */
export interface HotelMembershipItem {
  id: string;
  name: string;
  slug: string;
  destination: string;
  role: Role;
}

export interface Profile {
  userId: string;
  email: string | null;
  displayName: string | null;
  isPlatformAdmin: boolean;
}

export interface AuthUser {
  id: string;
  email: string | null;
}
