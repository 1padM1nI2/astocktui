import { expect, test } from "bun:test"
import { AgentController, type AgentDriver } from "../../src/agent/controller"
import { AgentEventDispatcher } from "../../src/agent/event-dispatcher"

class Driver implements AgentDriver {
  readonly inputs: string[] = []
  async run(input: string): Promise<void> {
    this.inputs.push(input)
  }
  clear(): void {}
  abort(): void {}

  usageSummary(): string {
    return ""
  }
}

test("系统事件按顺序派发并去重", async () => {
  const driver = new Driver()
  const dispatcher = new AgentEventDispatcher(new AgentController(driver, "test"))
  expect(
    dispatcher.enqueue({
      kind: "custom",
      dedupeKey: "x",
      title: "检查",
      prompt: "一",
      createdAt: "x",
    }),
  ).toBe("queued")
  expect(
    dispatcher.enqueue({
      kind: "custom",
      dedupeKey: "x",
      title: "检查",
      prompt: "一",
      createdAt: "x",
    }),
  ).toBe("deduped")
  await dispatcher.whenIdle()
  expect(driver.inputs).toEqual(["一"])
})
