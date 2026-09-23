// Derive the per-session state shown by `kilo session list`. Kept pure and
// separate from the command so it is unit-testable without booting the CLI.
export type SessionState = { status: "scheduled" | "idle" | string; scheduledAt?: string }

type Status = { type: string; scheduledAt?: string }

export function sessionStates(input: {
  sessions: readonly { id: string }[]
  wakeups: readonly { sessionID: string; dueAt: number }[]
  statuses: ReadonlyMap<string, Status>
  now?: number
}): Map<string, SessionState> {
  const now = input.now ?? Date.now()

  // Earliest wake still due per session. A past due time is spent, never shown.
  const next = new Map<string, number>()
  for (const wake of input.wakeups) {
    if (wake.dueAt <= now) continue
    const held = next.get(wake.sessionID)
    if (held == null || wake.dueAt < held) next.set(wake.sessionID, wake.dueAt)
  }

  const out = new Map<string, SessionState>()
  for (const session of input.sessions) {
    const info = input.statuses.get(session.id)
    // A turn running now (busy, retry, offline) outranks a pending wake, the
    // same precedence the status wire uses: `scheduled` only while nothing runs.
    if (info && info.type !== "idle" && info.type !== "scheduled") {
      out.set(session.id, { status: info.type })
      continue
    }
    const due = next.get(session.id)
    if (due != null) {
      out.set(session.id, { status: "scheduled", scheduledAt: new Date(due).toISOString() })
      continue
    }
    // A scheduled status with no wake left to read carries its own wake time.
    if (info?.type === "scheduled" && info.scheduledAt != null) {
      out.set(session.id, { status: "scheduled", scheduledAt: info.scheduledAt })
      continue
    }
    out.set(session.id, { status: info?.type ?? "idle" })
  }
  return out
}
