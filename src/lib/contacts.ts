// ---------------------------------------------------------------------------
// Contacts — the privacy-preserving way to find friends who are actually in
// YOUR address book. Uses the browser Contacts API (Chrome on Android /
// desktop, requires HTTPS + a user gesture); when it's unavailable the UI
// falls back to a manual phone lookup. Matching is pure and testable.
// ---------------------------------------------------------------------------

import type { DirectoryUser } from "../data/seed";
import { findByPhone, normalizePhone } from "../engine/friends";

export interface ContactRecord {
  name?: string;
  tel?: string[];
  email?: string[];
}

interface ContactsNav {
  contacts?: {
    select(fields: string[], options?: unknown): Promise<ContactRecord[]>;
    getProperties?(): Promise<string[]>;
  };
}

/** Whether this browser can read contacts (Chrome/Edge + secure context). */
export function contactsSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as ContactsNav;
  return !!nav.contacts?.select;
}

/**
 * Ask the user to share contacts (browser permission UI). Resolves to the
 * picked records, or null when unsupported / cancelled / denied — callers
 * show the manual phone fallback instead.
 */
export async function pickContacts(): Promise<ContactRecord[] | null> {
  const nav = navigator as ContactsNav;
  if (!nav.contacts?.select) return null;
  try {
    const picked = await nav.contacts.select(["name", "tel", "email"]);
    return Array.isArray(picked) ? picked : null;
  } catch {
    return null;
  }
}

/**
 * Which directory users appear in a list of contacts — matched by phone
 * number or email, both normalized. Only the user's OWN contacts drive this,
 * so the suggestions genuinely matter to them.
 */
export function matchContactsToDirectory(
  contacts: ContactRecord[],
  directory: DirectoryUser[]
): DirectoryUser[] {
  const matched = new Set<string>();
  for (const c of contacts) {
    for (const tel of c.tel ?? []) {
      if (!normalizePhone(tel)) continue;
      const u = findByPhone(directory, tel);
      if (u) matched.add(u.email.toLowerCase());
    }
    for (const em of c.email ?? []) {
      const em2 = em.trim().toLowerCase();
      const u = directory.find((d) => d.email.toLowerCase() === em2);
      if (u) matched.add(u.email.toLowerCase());
    }
  }
  return directory.filter((d) => matched.has(d.email.toLowerCase()));
}
