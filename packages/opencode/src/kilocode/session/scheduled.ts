import type { SessionID } from "@/session/schema"

export type Entry = { dueAt: number; directory: string }

// Process-global pending wakes, keyed by session id. The status layer reads it
// to report `scheduled` without depending on the Wakeup service, which keeps
// the upstream SessionStatus module free of a Kilo service dependency.
const entries = new Map<SessionID, Entry>()

export function set(sessionID: SessionID, dueAt: number, directory: string) {
  entries.set(sessionID, { dueAt, directory })
}

export function clear(sessionID: SessionID) {
  entries.delete(sessionID)
}

// A past due time must never surface: drop the entry and report nothing.
export function get(sessionID: SessionID, now = Date.now()): Entry | undefined {
  const entry = entries.get(sessionID)
  if (!entry) return undefined
  if (entry.dueAt <= now) {
    entries.delete(sessionID)
    return undefined
  }
  return entry
}

export function forDirectory(directory: string, now = Date.now()): [SessionID, Entry][] {
  const found: [SessionID, Entry][] = []
  for (const [sessionID, entry] of entries) {
    if (entry.directory !== directory) continue
    if (entry.dueAt <= now) {
      entries.delete(sessionID)
      continue
    }
    found.push([sessionID, entry])
  }
  return found
}

export function info(entry: Entry): { type: "scheduled"; scheduledAt: string } {
  return { type: "scheduled", scheduledAt: new Date(entry.dueAt).toISOString() }
}
