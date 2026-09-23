import { expect, test } from "bun:test"
import openapi from "../../openapi.json"

test("SessionStatus exposes the scheduled variant with scheduledAt", () => {
  const wire = JSON.stringify(openapi.components.schemas.SessionStatus)

  expect(wire).toContain('"scheduled"')
  expect(wire).toContain('"scheduledAt"')
})
