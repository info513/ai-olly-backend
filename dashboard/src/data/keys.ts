/** Centralized TanStack Query keys — all content queries are scoped by hotel id. */
export const qk = {
  contentSummary: (h?: string) => ["content", "summary", h] as const,
  roomTypes: (h?: string) => ["content", "roomTypes", h] as const,
  roomType: (id?: string) => ["content", "roomType", id] as const,
  rooms: (h?: string) => ["content", "rooms", h] as const,
  room: (id?: string) => ["content", "room", id] as const,
  resolvedRooms: (h?: string) => ["content", "resolvedRooms", h] as const,
  resolvedRoom: (id?: string) => ["content", "resolvedRoom", id] as const,
  categories: (h?: string) => ["content", "categories", h] as const,
  services: (h?: string) => ["content", "services", h] as const,
  service: (id?: string) => ["content", "service", id] as const,
  serviceVersions: (id?: string) => ["content", "serviceVersions", id] as const,
  resolvedServices: (h?: string) => ["content", "resolvedServices", h] as const,
};
