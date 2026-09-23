import { test, expect, describe } from "bun:test"
import { sessionStates } from "../../../src/kilocode/cli/session-list"

const now = Date.parse("2026-09-23T12:00:00.000Z")
const sessions = [{ id: "ses_1" }]

describe("sessionStates", () => {
  test("a future wake makes the session scheduled with its ISO wake time", () => {
    const dueAt = now + 60_000
    const states = sessionStates({
      sessions,
      wakeups: [{ sessionID: "ses_1", dueAt }],
      statuses: new Map(),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "scheduled", scheduledAt: new Date(dueAt).toISOString() })
  })

  test("a past wake is ignored and yields idle with no wake time", () => {
    const states = sessionStates({
      sessions,
      wakeups: [{ sessionID: "ses_1", dueAt: now - 1 }],
      statuses: new Map(),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "idle" })
    expect(states.get("ses_1")?.scheduledAt).toBeUndefined()
  })

  test("two wakes for one session pick the earliest future one", () => {
    const early = now + 30_000
    const late = now + 120_000
    const states = sessionStates({
      sessions,
      wakeups: [
        { sessionID: "ses_1", dueAt: late },
        { sessionID: "ses_1", dueAt: early },
      ],
      statuses: new Map(),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "scheduled", scheduledAt: new Date(early).toISOString() })
  })

  test("a busy status without a wake yields busy", () => {
    const states = sessionStates({
      sessions,
      wakeups: [],
      statuses: new Map([["ses_1", { type: "busy" }]]),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "busy" })
  })

  test("a session with neither a wake nor a status yields idle", () => {
    const states = sessionStates({ sessions, wakeups: [], statuses: new Map(), now })
    expect(states.get("ses_1")).toEqual({ status: "idle" })
  })

  test("a wake that has passed drops the row back to idle", () => {
    const dueAt = now + 1_000
    const before = sessionStates({ sessions, wakeups: [{ sessionID: "ses_1", dueAt }], statuses: new Map(), now })
    expect(before.get("ses_1")?.status).toBe("scheduled")

    const after = sessionStates({
      sessions,
      wakeups: [{ sessionID: "ses_1", dueAt }],
      statuses: new Map(),
      now: dueAt + 1,
    })
    expect(after.get("ses_1")).toEqual({ status: "idle" })
  })

  test("a turn running now outranks a pending wake", () => {
    const states = sessionStates({
      sessions,
      wakeups: [{ sessionID: "ses_1", dueAt: now + 60_000 }],
      statuses: new Map([["ses_1", { type: "busy" }]]),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "busy" })
  })

  test("a wake for another session does not leak into this row", () => {
    const states = sessionStates({
      sessions,
      wakeups: [{ sessionID: "ses_2", dueAt: now + 60_000 }],
      statuses: new Map(),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "idle" })
  })

  test("a scheduled status without a readable wake keeps its own wake time", () => {
    const dueAt = now + 60_000
    const states = sessionStates({
      sessions,
      wakeups: [],
      statuses: new Map([["ses_1", { type: "scheduled", scheduledAt: new Date(dueAt).toISOString() }]]),
      now,
    })
    expect(states.get("ses_1")).toEqual({ status: "scheduled", scheduledAt: new Date(dueAt).toISOString() })
  })
})
