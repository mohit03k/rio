import type { Tool, ToolResult } from "ai/types/tool";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateOutput } from "./utils/truncate";

function findBash() {
  if (process.platform != "win32") {
    return "bash" // if the platform is linux or macos(darwin) or any other . this will return
  }

  // else this might be windows.
  const paths = [];
  const programFiles = process.env.ProgramFiles;
  if (programFiles) {
    paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
  }
  const programFilesX86 = process.env["ProgramFiles(x86)"]; // for 32 bit applications
  if (programFilesX86) {
    paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
  }
  const localProfile = process.env.LOCALAPPDATA;
  if (localProfile) {
    paths.push(`${localProfile}\\Programs\\Git\\bin\\bash.exe`)
  }

  const exists = paths.find((p) => existsSync(p)); // returns true if for any of these paths acutually exists
  if (exists) return exists; // if found return bash path

  // Git can live on any drive, so also look along PATH, skipping the WSL launcher in System32
  for (const dir of (process.env.PATH ?? "").split(delimiter)) { // process.env.PATH returns aall directory from where an .exe can be found 
    if (!dir || /\\system32$/i.test(dir.replace(/\\+$/, ""))) continue; // this regex skips some dir like system32 
    const candidate = join(dir, "bash.exe");
    if (existsSync(candidate)) return candidate; // for every dir /bash.exe checks if it exists or not
  };

  throw new Error(
    "Bash not found. Install Git for Windows or add the directory containing bash.exe to PATH."
  );
}


function runBash(command: string, timeout: number): Promise<ToolResult> { // returns string
  return new Promise((resolve) => {
    const child = spawn(findBash(), ["-c", command], {
      cwd: process.cwd(),
      windowsHide: true,
      // if true if your main parent (core) process crashes the child is in group so it can keep running. its not true for windows
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let settled = false;

    function finish(content: string, isError: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ content, isError });
    }

    child.stdout.on("data", (data) => { // on any success command data
      output += data.toString();
    });

    child.stderr.on("data", (data) => { // on any command fail data
      output += data.toString();
    });

    const timer = setTimeout(() => { // timeout to kill the child_process
      if (child.pid !== undefined) {// if the child process is failed to spawn the pid is undefined so we add a check
        try {
          if (process.platform === "win32") {
            const killer = spawn(
              "taskkill",
              ["/F", "/T", "/PID", String(child.pid)],
              { windowsHide: true, stdio: "ignore" },
            );

            killer.on("error", () => {
              child.kill("SIGKILL");
            });
          } else {
            // Negative PID targets the process group created by detached.
            // for linux/macos
            process.kill(-child.pid, "SIGKILL");
          }
        } catch (error) {
          // The process group might already have exited.
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            output += `\nFailed to terminate command: ${error}`;
          }
        }
      }
      // Descendants may still hold the output pipes open.
      child.stdout.destroy();
      child.stderr.destroy();

      finish(
        `${output}\nTimed out after ${timeout / 1000} seconds`,
        true,
      );
    }, timeout);

    child.on("error", (error) => {
      finish(`${output}\nFailed to start Bash: ${error.message}`, true);
    });

    // after successully running command and child_process closes at end
    child.on("close", (code, signal) => {
      const status = signal
        ? `terminated by signal: ${signal}`
        : `exit code: ${code}`;

      finish(`${output}\n${status}`, code !== 0);
    });
  })
}


export const bashTool: Tool = {
  name: "bash",
  description: `Execute a shell command in the current working directory. Timeout: 30 seconds. Returns stdout and stderr.
    Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute"
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)" // 30 secs default
      }
    },
    required: ["command"]
  },

  async execute(args) {
    // if windows then Git bash in windows cmd (this allows us to run UNIX style commands in windows cmd. like ls, pwd, cd, mkdir etc). 
    // then bash commands 

    const timeout = args.timeout ?? 30000; // if not timeout fallback to 30 sec
    if (typeof timeout !== "number") {
      return {
        content: "timeout must be a number",
        isError: true,
      };
    }

    if (
      typeof args.command !== "string" ||
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      timeout > 2_147_483_647) {
      return {
        content: "Invalid argumnets. command must be string and timeout must be a postive integer upto 2147483647 milliseconds",
        isError: true
      }
    };
    const result = await runBash(args.command, timeout);
    return {
      content: truncateOutput(result.content),
      isError: result.isError
    }
  },
}

