import type { Tool } from "ai/types/tool";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
// after building add output accumulator. Bounded memory and tail truncation. process lifecycle to end after timeout

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
// keep the END of the output (errors and results are usually at the bottom).
// keep the last 2k lines then keep the las 51800 bytes of those 2k lines (as lines may have emoji and character which takes more bytes)
function truncateOutput(output: string): string {
  if (!output) return output;

  const lines = output.split("\n");
  let out = lines.slice(-DEFAULT_MAX_LINES).join("\n"); // grabs the last 2k lines (max or low) and joins them
  let partialLine = false;

  const bytes = Buffer.from(out, "utf8");

  if (bytes.length > DEFAULT_MAX_BYTES) { // if more than max bytest. remove those bytes
    // start is byte position where retained output should begin
    // start = 60,000 - 51,200 = 8,800
    // [ first 8,800 bytes ][ last 51,200 bytes ]
    //        discard              keep
    let start = bytes.length - DEFAULT_MAX_BYTES;

    // Skip UTF-8 continuation bytes to avoid splitting a character.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
      start++;
    }

    partialLine = bytes[start - 1] !== 0x0a;
    out = bytes.subarray(start).toString("utf8");
  }

  if (out === output) return output;

  const kept = out.split("\n");
  const note = partialLine ? "; first shown line is partial" : "";

  return `[truncated: showing the last ${kept.length} of ${lines.length} lines${note}]\n${out}`;
}

function runBash(command: string, timeout: number): Promise<string> { // returns string
  return new Promise((resolve) => {
    const child = spawn(findBash(), ["-c", command], { cwd: process.cwd(), windowsHide: true });
    let output = "";
    child.stdout.on("data", (data) => output += data.toString());
    // if the command ran gave some data. but error
    child.stderr.on("data", (data) => output += data.toString());

    const timer = setTimeout(() => {
      // command took too long
      // if timeout completed then kill the process return error. 

      // if the platform is child.kill() doesnt kill the child process
      // so we use /T to kill whole tree
      if (process.platform === "win32") {
        spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)]);
      } else child.kill("SIGKILL");
      output += `timed out after ${timeout / 1000} seconds`
    }, timeout);

    child.on("error", (e) => { // if while spawning child process got some error
      clearTimeout(timer);
      resolve(`failed to start bash: ${e}`)
    });

    // on success close after running command
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(`${output}\n exit code: ${code}`)
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
    requied: ["command", "timeout"]
  },

  async execute(args) {
    // if windows then Git bash in windows cmd (this allows us to run UNIX style commands in windows cmd. like ls, pwd, cd, mkdir etc). 
    // then bash commands 

    if (typeof args.command !== "string" || typeof args.timeout !== "number") {
      return {
        content: "Invalid argumnets. command must be string and timeout must be a number",
        isError: true
      }
    };
    const res = truncateOutput(await runBash(args.command, args.timeout));
    return {
      content: res,
      isError: false
    }
  },


}
