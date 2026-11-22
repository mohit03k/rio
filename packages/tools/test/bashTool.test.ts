import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../src/bashTool";

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for process state");
}

test("already-aborted execution does not start a command", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await bashTool.execute({ command: "echo should-not-run" }, { signal: controller.signal });
  expect(result.isCancelled).toBe(true);
  expect(result.isError).toBe(true);
  expect(result.content).not.toContain("should-not-run");
});

test("ordinary command success, failure and timeout still work", async () => {
  expect((await bashTool.execute({ command: "echo hello" })).isError).toBe(false);
  expect((await bashTool.execute({ command: "exit 1" })).isError).toBe(true);
  const timedOut = await bashTool.execute({ command: "sleep 10", timeout: 50 });
  expect(timedOut.isError).toBe(true);
  expect(timedOut.isCancelled).toBe(false);
  expect(timedOut.content).toContain("Timed out");
});

test.skipIf(process.platform !== "linux")("cancellation kills Bash and its ordinary descendants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rio-bash-abort-"));
  const pidfile = join(directory, "pids");
  const controller = new AbortController();
  const pending = bashTool.execute({
    command: `sleep 30 & echo "$$ $!" > '${pidfile}'; echo started; wait`,
  }, { signal: controller.signal });

  try {
    await waitFor(() => existsSync(pidfile));
    const pids = readFileSync(pidfile, "utf8").trim().split(" ").map(Number);
    controller.abort();
    const result = await pending;
    expect(result.isCancelled).toBe(true);
    expect(result.content).toContain("Command cancelled");

    await waitFor(() => pids.every(pid => {
      try {
        // An orphaned zombie is stopped but may await reaping by container PID 1.
        return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z") ?? false;
      } catch {
        return true;
      }
    }));
    expect((await bashTool.execute({ command: "echo next-run" })).content).toContain("next-run");
  } finally {
    controller.abort();
    await pending;
    rmSync(directory, { recursive: true, force: true });
  }
});
