// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import { disposeInstance } from "../../src/effect/instance-registry"
import { SessionStatus } from "../../src/session/status"
import { SessionID } from "../../src/session/schema"
import * as scheduled from "../../src/kilocode/session/scheduled"
import type { InstanceContext } from "../../src/project/instance-context"

// SessionStatus only publishes through the bridge; recording the calls is
// enough to assert what the idle branch emits.
const published: { type: string; data: unknown }[] = []
const events = Layer.succeed(
  EventV2Bridge.Service,
  EventV2Bridge.Service.of({
    publish: (definition: { type: string }, data: unknown) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
      }),
  } as unknown as EventV2.Interface),
)

// One memoized runtime mirrors the production app runtime: the InstanceState
// ScopedCache is built once and shared across run calls, keyed per directory.
const runtime = ManagedRuntime.make(SessionStatus.layer.pipe(Layer.provide(events)))

// In kilo run the session prompt loop runs under one directory and the heartbeat
// gather runs under another, but both belong to one project (main worktree +
// section worktrees of the same repo). SessionStatus must be readable across
// directories within a project while staying isolated across projects.
const instance = (directory: string, projectID: string): InstanceContext =>
  ({ directory, worktree: directory, project: { id: projectID } } as unknown as InstanceContext)

const provide = (directory: string, projectID: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(InstanceRef, instance(directory, projectID)))

describe("SessionStatus", () => {
  test("a busy status set under one directory is visible to listAll under another directory in the same project", async () => {
    const id = SessionID.make("ses_cross_directory")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(
          provide("/tmp/dir-a", "proj"),
        )
        return yield* SessionStatus.listAll().pipe(provide("/tmp/dir-b", "proj"))
      }),
    )

    expect(map.get(id)).toEqual({ type: "busy" })
  })

  test("listAll does not leak a busy status across projects", async () => {
    const id = SessionID.make("ses_project_isolation")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(
          provide("/tmp/dir-a", "proj-a"),
        )
        return yield* SessionStatus.listAll().pipe(provide("/tmp/dir-b", "proj-b"))
      }),
    )

    expect(map.get(id)).toBeUndefined()
  })

  test("list keeps per-directory isolation for instance consumers", async () => {
    const id = SessionID.make("ses_list_isolation")

    const [same, other] = await runtime.runPromise(
      Effect.gen(function* () {
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(
          provide("/tmp/dir-a", "proj"),
        )
        const same = yield* SessionStatus.Service.use((svc) => svc.list()).pipe(provide("/tmp/dir-a", "proj"))
        const other = yield* SessionStatus.Service.use((svc) => svc.list()).pipe(provide("/tmp/dir-b", "proj"))
        return [same, other] as const
      }),
    )

    expect(same.get(id)).toEqual({ type: "busy" })
    expect(other.get(id)).toBeUndefined()
  })

  test("an idle status still deletes the entry, keeping the project store self-cleaning", async () => {
    const id = SessionID.make("ses_idle_cleanup")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(
          provide("/tmp/dir-a", "proj"),
        )
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "idle" })).pipe(
          provide("/tmp/dir-a", "proj"),
        )
        return yield* SessionStatus.listAll().pipe(provide("/tmp/dir-b", "proj"))
      }),
    )

    expect(map.get(id)).toBeUndefined()
  })

  test("instance dispose drops the disposed directory's busy sessions from the project store", async () => {
    const id = SessionID.make("ses_dispose_cleanup")

    const before = await runtime.runPromise(
      Effect.gen(function* () {
        yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(
          provide("/tmp/dispose-a", "proj-dispose"),
        )
        return yield* SessionStatus.listAll().pipe(provide("/tmp/dispose-b", "proj-dispose"))
      }),
    )
    expect(before.get(id)).toEqual({ type: "busy" })

    await disposeInstance("/tmp/dispose-a")

    const after = await runtime.runPromise(SessionStatus.listAll().pipe(provide("/tmp/dispose-b", "proj-dispose")))
    expect(after.get(id)).toBeUndefined()
  })

  test("a future wake reports scheduled from get and list in its own directory only", async () => {
    const id = SessionID.make("ses_scheduled_future")
    const dueAt = Date.now() + 60_000
    const expected = { type: "scheduled" as const, scheduledAt: new Date(dueAt).toISOString() }
    scheduled.set(id, dueAt, "/tmp/sched-a")

    try {
      const [one, listA, listB] = await runtime.runPromise(
        Effect.gen(function* () {
          const one = yield* SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj"))
          const listA = yield* SessionStatus.Service.use((svc) => svc.list()).pipe(provide("/tmp/sched-a", "proj"))
          const listB = yield* SessionStatus.Service.use((svc) => svc.list()).pipe(provide("/tmp/sched-b", "proj"))
          return [one, listA, listB] as const
        }),
      )

      expect(one).toEqual(expected)
      expect(listA.get(id)).toEqual(expected)
      expect(listB.get(id)).toBeUndefined()
    } finally {
      scheduled.clear(id)
    }
  })

  test("a past wake is never reported as scheduled", async () => {
    const id = SessionID.make("ses_scheduled_past")
    scheduled.set(id, Date.now() - 1_000, "/tmp/sched-a")

    const one = await runtime.runPromise(
      SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj")),
    )

    expect(one).toEqual({ type: "idle" })
    expect(scheduled.get(id)).toBeUndefined()
  })

  test("a turn running in the session's directory reports busy, not scheduled", async () => {
    const id = SessionID.make("ses_scheduled_busy")
    scheduled.set(id, Date.now() + 60_000, "/tmp/sched-a")

    try {
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(provide("/tmp/sched-a", "proj"))
          return yield* SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj"))
        }),
      )

      expect(one).toEqual({ type: "busy" })
    } finally {
      scheduled.clear(id)
      await runtime.runPromise(
        SessionStatus.Service.use((svc) => svc.set(id, { type: "idle" })).pipe(provide("/tmp/sched-a", "proj")),
      )
    }
  })

  test("a turn running in a sibling directory suppresses the scheduled status", async () => {
    const id = SessionID.make("ses_scheduled_busy_sibling")
    scheduled.set(id, Date.now() + 60_000, "/tmp/sched-a")

    try {
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(provide("/tmp/sched-b", "proj"))
          return yield* SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj"))
        }),
      )

      expect(one).toEqual({ type: "idle" })
    } finally {
      scheduled.clear(id)
      await runtime.runPromise(
        SessionStatus.Service.use((svc) => svc.set(id, { type: "idle" })).pipe(provide("/tmp/sched-b", "proj")),
      )
    }
  })

  test("going idle with a pending future wake publishes scheduled, not idle", async () => {
    const id = SessionID.make("ses_scheduled_idle_set")
    const dueAt = Date.now() + 60_000
    const expected = { type: "scheduled" as const, scheduledAt: new Date(dueAt).toISOString() }
    scheduled.set(id, dueAt, "/tmp/sched-a")
    const before = published.length

    try {
      const one = await runtime.runPromise(
        Effect.gen(function* () {
          yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })).pipe(provide("/tmp/sched-a", "proj"))
          yield* SessionStatus.Service.use((svc) => svc.set(id, { type: "idle" })).pipe(provide("/tmp/sched-a", "proj"))
          return yield* SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj"))
        }),
      )

      expect(one).toEqual(expected)
      const status = published
        .slice(before)
        .filter((event) => event.type === "session.status")
        .at(-1)
      expect(status?.data).toEqual({ sessionID: id, status: expected })
    } finally {
      scheduled.clear(id)
    }
  })

  test("a cancelled wake reports idle again", async () => {
    const id = SessionID.make("ses_scheduled_clear")
    scheduled.set(id, Date.now() + 60_000, "/tmp/sched-a")
    scheduled.clear(id)

    const one = await runtime.runPromise(
      SessionStatus.Service.use((svc) => svc.get(id)).pipe(provide("/tmp/sched-a", "proj")),
    )

    expect(one).toEqual({ type: "idle" })
  })
})
