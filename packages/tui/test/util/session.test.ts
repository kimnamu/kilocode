import { describe, expect, test } from "bun:test"
import { isDefaultTitle, scheduledWake, working } from "../../src/util/session" // kilocode_change

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  // kilocode_change start - scheduled is idle; busy/retry/offline still work
  test("treats idle and scheduled as not working", () => {
    expect(working("idle")).toBeFalse()
    expect(working("scheduled")).toBeFalse()
  })

  test("treats busy, retry and offline as working", () => {
    expect(working("busy")).toBeTrue()
    expect(working("retry")).toBeTrue()
    expect(working("offline")).toBeTrue()
  })

  test("treats a missing status as not working", () => {
    expect(working(undefined)).toBeFalse()
  })

  test("returns the wake time for a scheduled status", () => {
    expect(scheduledWake({ type: "scheduled", scheduledAt: "2026-06-06T12:34:56.789Z" })).toBe(
      "2026-06-06T12:34:56.789Z",
    )
  })

  test("returns no wake time for idle and busy statuses", () => {
    expect(scheduledWake({ type: "idle" })).toBeUndefined()
    expect(scheduledWake({ type: "busy" })).toBeUndefined()
    expect(scheduledWake(undefined)).toBeUndefined()
  })
  // kilocode_change end
})
