import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status" // kilocode_change
import { Wakeup } from "@/kilocode/wakeup" // kilocode_change
import { sessionStates, type SessionState } from "@/kilocode/cli/session-list" // kilocode_change
import { SessionID } from "../../session/schema"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.KILO_GIT_BASH_PATH) {
    const less = path.join(Flag.KILO_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionDeleteCommand).demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const sessionID = SessionID.make(args.sessionID)
    yield* svc
      .remove(sessionID)
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      // kilocode_change start
      .option("all", {
        alias: "a",
        describe: "list sessions from all projects",
        type: "boolean",
        default: false,
      })
      .option("search", {
        alias: "s",
        describe: "filter sessions by title",
        type: "string",
      }),
  // kilocode_change end
  handler: Effect.fn("Cli.session.list")(function* (args) {
    // kilocode_change start
    const sessions = args.all
      ? yield* Session.Service.use((svc) => svc.listGlobal({ roots: true, limit: args.maxCount, search: args.search }))
      : yield* Session.Service.use((svc) => svc.list({ roots: true, limit: args.maxCount, search: args.search }))
    // kilocode_change end

    if (sessions.length === 0) return

    // kilocode_change start
    const states = sessionStates({
      sessions,
      wakeups: yield* Wakeup.Service.use((svc) => svc.list()),
      statuses: yield* SessionStatus.Service.use((svc) => svc.list()),
    })

    const output =
      args.format === "json"
        ? args.all
          ? formatGlobalSessionJSON(sessions as Session.GlobalInfo[], states)
          : formatSessionJSON(sessions as Session.Info[], states)
        : args.all
          ? formatGlobalSessionTable(sessions as Session.GlobalInfo[], states)
          : formatSessionTable(sessions as Session.Info[], states)
    // kilocode_change end

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

// kilocode_change start
function stateOf(states: Map<string, SessionState>, id: string): SessionState {
  return states.get(id) ?? { status: "idle" }
}

function formatSessionTable(sessions: Session.Info[], states: Map<string, SessionState>): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxUpdatedWidth = Math.max(
    "Updated".length,
    ...sessions.map((s) => Locale.todayTimeOrDateTime(s.time.updated).length),
  )
  const maxStatusWidth = Math.max("Status".length, ...sessions.map((s) => stateOf(states, s.id).status.length))
  const maxScheduledWidth = Math.max(
    "Scheduled At".length,
    ...sessions.map((s) => (stateOf(states, s.id).scheduledAt ?? "").length),
  )

  const header =
    `Session ID${" ".repeat(maxIdWidth - 10)}` +
    `  Title${" ".repeat(maxTitleWidth - 5)}` +
    `  Updated${" ".repeat(maxUpdatedWidth - 7)}` +
    `  Status${" ".repeat(maxStatusWidth - 6)}` +
    `  Scheduled At${" ".repeat(maxScheduledWidth - 12)}`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const state = stateOf(states, session.id)
    const line =
      `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr.padEnd(maxUpdatedWidth)}` +
      `  ${state.status.padEnd(maxStatusWidth)}  ${(state.scheduledAt ?? "").padEnd(maxScheduledWidth)}`
    lines.push(line)
  }

  return lines.join(EOL)
}
// kilocode_change end

// kilocode_change start
function formatSessionJSON(sessions: Session.Info[], states: Map<string, SessionState>): string {
  const jsonData = sessions.map((session) => {
    const state = stateOf(states, session.id)
    return {
      id: session.id,
      title: session.title,
      updated: session.time.updated,
      created: session.time.created,
      projectId: session.projectID,
      directory: session.directory,
      status: state.status,
      // Only a scheduled row carries the wake time; never `undefined`/`null`.
      ...(state.scheduledAt != null ? { scheduledAt: state.scheduledAt } : {}),
    }
  })
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end

// kilocode_change start
function formatGlobalSessionTable(sessions: Session.GlobalInfo[], states: Map<string, SessionState>): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxProjectWidth = Math.max(
    10,
    ...sessions.map((s) => (s.project?.name ?? s.project?.worktree ?? "unknown").length),
  )
  const maxUpdatedWidth = Math.max(
    "Updated".length,
    ...sessions.map((s) => Locale.todayTimeOrDateTime(s.time.updated).length),
  )
  const maxStatusWidth = Math.max("Status".length, ...sessions.map((s) => stateOf(states, s.id).status.length))
  const maxScheduledWidth = Math.max(
    "Scheduled At".length,
    ...sessions.map((s) => (stateOf(states, s.id).scheduledAt ?? "").length),
  )

  const header =
    `Session ID${" ".repeat(maxIdWidth - 10)}` +
    `  Title${" ".repeat(maxTitleWidth - 5)}` +
    `  Project${" ".repeat(maxProjectWidth - 7)}` +
    `  Updated${" ".repeat(maxUpdatedWidth - 7)}` +
    `  Status${" ".repeat(maxStatusWidth - 6)}` +
    `  Scheduled At${" ".repeat(maxScheduledWidth - 12)}`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const project = Locale.truncate(session.project?.name ?? session.project?.worktree ?? "unknown", maxProjectWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const state = stateOf(states, session.id)
    const line =
      `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${project.padEnd(maxProjectWidth)}` +
      `  ${timeStr.padEnd(maxUpdatedWidth)}  ${state.status.padEnd(maxStatusWidth)}` +
      `  ${(state.scheduledAt ?? "").padEnd(maxScheduledWidth)}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatGlobalSessionJSON(sessions: Session.GlobalInfo[], states: Map<string, SessionState>): string {
  const jsonData = sessions.map((session) => {
    const state = stateOf(states, session.id)
    return {
      id: session.id,
      title: session.title,
      updated: session.time.updated,
      created: session.time.created,
      projectId: session.projectID,
      directory: session.directory,
      project: session.project
        ? { id: session.project.id, name: session.project.name, worktree: session.project.worktree }
        : null,
      status: state.status,
      ...(state.scheduledAt != null ? { scheduledAt: state.scheduledAt } : {}),
    }
  })
  return JSON.stringify(jsonData, null, 2)
}
// kilocode_change end
