import { expect, mock, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import type { Message, Provider } from "ai/types/provider";

const requests: Message[][] = [];
let finishStream: () => void;
const streamGate = new Promise<void>(resolve => { finishStream = resolve; });

const provider: Provider = {
  name: "test",
  defaultModel: "test-model",
  async *stream({ messages }) {
    requests.push([...messages]);
    const usage = { input: 1, output: 1 };
    if (requests.length === 1) {
      yield { type: "text_delta", delta: "Looking" };
      await streamGate;
      yield { type: "text_delta", delta: " now" };
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Looking now" },
            { type: "tool_call", id: "read-1", name: "read", arguments: { path: "package.json" } },
          ],
          usage,
          stopReason: "toolUse",
        },
      };
    } else if (requests.length === 2) {
      yield { type: "text_delta", delta: "Finished reading." };
      yield {
        type: "done",
        message: { role: "assistant", content: [{ type: "text", text: "Finished reading." }], usage, stopReason: "stop" },
      };
    } else {
      throw new Error("Test provider failed");
    }
  },
};

mock.module("ai/providers", () => ({ getProvider: () => provider }));
const { default: App } = await import("../source/app.js");

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for UI update");
}

test("streams text, runs a tool, retains history, handles errors and clears chat", async () => {
  const savedKey = process.env.OPENROUTER_API;
  process.env.OPENROUTER_API = "test-key";
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode() {}, ref() {}, unref() {},
  });
  const stdout = Object.assign(new PassThrough(), { columns: 100 });
  let lastFrame = "";
  stdout.on("data", chunk => { lastFrame = chunk.toString(); });
  const ui = render(<App />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const frame = () => lastFrame;
  async function submit(text: string) {
    await Bun.sleep(60);
    stdin.write(text);
    await waitFor(() => frame().includes(`> ${text}`));
    await Bun.sleep(80);
    stdin.write("\r");
  }

  try {
    await Bun.sleep(50);
    await submit("Read the package");
    await waitFor(() => frame().includes("Looking"));
    expect(frame()).toContain("Working...");

    // Input while the agent runs must not start another run.
    stdin.write("duplicate");
    await Bun.sleep(50);
    stdin.write("\r");
    await Bun.sleep(50);
    expect(requests).toHaveLength(1);
    finishStream!();

    await waitFor(() => frame().includes("Finished reading.") && !frame().includes("Working..."));
    expect(frame()).toContain("read: done");
    expect(frame().match(/Looking now/g)).toHaveLength(1);
    expect(requests[1]?.some(message => message.role === "toolResult")).toBe(true);

    await submit("Follow up");
    await waitFor(() => frame().includes("Test provider failed"));
    expect(requests[2]?.filter(message => message.role === "user")).toHaveLength(2);
    expect(frame()).not.toContain("Working...");

    // A failed run must still allow the user to submit again.
    await submit("Try again");
    await waitFor(() => requests.length === 4 && !frame().includes("Working..."));
    expect(requests[3]?.some(message => message.role === "user" && message.content === "Follow up")).toBe(false);

    await Bun.sleep(60);
    stdin.write("/");
    await Bun.sleep(60);
    stdin.write("new");
    await Bun.sleep(60);
    stdin.write("\r");
    await waitFor(() => !frame().includes("Read the package"));
    expect(frame()).not.toContain("Finished reading.");
  } finally {
    ui.unmount();
    ui.cleanup();
    if (savedKey === undefined) delete process.env.OPENROUTER_API;
    else process.env.OPENROUTER_API = savedKey;
  }
});
