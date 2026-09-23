import type { SessionStatus } from "@kilocode/sdk/v2" // kilocode_change

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

// kilocode_change start - scheduled sessions are idle, not working
export function working(type: SessionStatus["type"] | undefined): boolean {
  return type !== undefined && type !== "idle" && type !== "scheduled"
}

export function scheduledWake(status: SessionStatus | undefined): string | undefined {
  return status?.type === "scheduled" ? status.scheduledAt : undefined
}
// kilocode_change end
