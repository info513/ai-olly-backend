import {
  COMMAND_ACTIONS,
  HOTELS,
  NOTIFICATIONS,
  SEARCH_ITEMS,
  DEMO_SESSION,
} from "./data";
import type {
  AppNotification,
  CommandAction,
  Hotel,
  HomeSummary,
  SearchItem,
  Session,
} from "./types";

/**
 * The Sprint-1 data boundary. Every screen reads through this typed provider so
 * that a later sprint can replace the body of each method with a real Supabase
 * call (RLS-scoped) without touching any component. Nothing here hits a network.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const mockProvider = {
  async signIn(_email: string, _password: string): Promise<Session> {
    await delay(500); // simulate auth round-trip
    return DEMO_SESSION;
  },

  async getSession(): Promise<Session | null> {
    await delay(120);
    return DEMO_SESSION;
  },

  async listHotels(): Promise<Hotel[]> {
    await delay(150);
    return HOTELS;
  },

  async listNotifications(): Promise<AppNotification[]> {
    await delay(200);
    return NOTIFICATIONS.map(({ minutesAgo, ...n }) => ({ ...n, createdAt: iso(minutesAgo) }));
  },

  async search(query: string): Promise<SearchItem[]> {
    await delay(90);
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_ITEMS.slice(0, 6);
    return SEARCH_ITEMS.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q)
    );
  },

  commandActions(): CommandAction[] {
    return COMMAND_ACTIONS;
  },

  async getHomeSummary(hotelId: string): Promise<HomeSummary> {
    await delay(360); // simulate an aggregate read
    return {
      hotelId,
      arrivals: [
        { id: "arr1", guestFirstName: "John", room: "204", time: "14:00" },
        { id: "arr2", guestFirstName: "Maria", room: "112", time: "15:30" },
        { id: "arr3", guestFirstName: "Lukas", room: "301", time: "16:00", note: "late arrival" },
        { id: "arr4", guestFirstName: "Sofia", room: "205", time: "18:20" },
        { id: "arr5", guestFirstName: "Ahmed", room: "108", time: "19:00" },
      ],
      departures: [
        { id: "dep1", guestFirstName: "Elena", room: "203", time: "10:30" },
        { id: "dep2", guestFirstName: "Tom", room: "310", time: "11:00" },
        { id: "dep3", guestFirstName: "Priya", room: "101", time: "11:00" },
      ],
      openRequests: [
        { id: "req1", title: "Extra towels", room: "204", priority: "normal", status: "new", createdAt: iso(18) },
        { id: "req2", title: "AC not cooling", room: "201", priority: "urgent", status: "acknowledged", createdAt: iso(46) },
        { id: "req3", title: "Late checkout", room: "310", priority: "normal", status: "in_progress", createdAt: iso(95) },
      ],
      aiCoveragePct: 94,
      aiHandoffPct: 6,
      knowledgeCompletenessPct: 82,
      draftsWaiting: 3,
      feedbackAverage: 4.7,
      recentActivity: [
        { id: "act1", actor: "Ivan", action: "published", target: "Airport Transfer (€45)", createdAt: iso(190), tier: "success" },
        { id: "act2", actor: "Ana", action: "answered request from", target: "Room 204", createdAt: iso(210), tier: "task" },
        { id: "act3", actor: "System", action: "flagged expiring", target: "Check‑in Policy", createdAt: iso(240), tier: "warning" },
        { id: "act4", actor: "Marko", action: "scheduled campaign", target: "Summer at Demo Hotel", createdAt: iso(300), tier: "info" },
        { id: "act5", actor: "Ivan", action: "updated Room Guide for", target: "Room 201", createdAt: iso(420), tier: "info" },
      ],
    };
  },
};

export type MockProvider = typeof mockProvider;
