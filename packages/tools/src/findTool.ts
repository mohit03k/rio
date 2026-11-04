import type { Tool } from "ai/types/tool";
import { stat } from "node:fs/promises"
import { serialize } from "node:v8";
import { ensureTool } from "./utils/helper";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DEFAULT_MAX_BYTES, truncateHead } from "./utils/truncate";


export const DEFAULT_FIND_LIMIT = 1000
export const findTool: Tool = {
  name: "find",
  description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. 
      Respects .gitignore.`,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"
      },
      path: { // optional
        type: "string",
        description: "Directory to search in (default: current directory)"
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 1000)"
      }
    },
    required: ["pattern"]
  },
  async execute(args) {
    if (typeof args.pattern !== "string") {
      return {
        content: "pattern must be a string",
        isError: true,
      };
    }

    if (args.path !== undefined && typeof args.path !== "string") {
      return {
        content: "path must be a string",
        isError: true,
      };
    }

    if (args.limit !== undefined && typeof args.limit !== "number") {
      return { content: "limit should be a positive integer", isError: true }
    }
    if (args.limit! <= 0) {
      return { content: "limit should be a positive integer ", isError: true }
    }

    const searchPath = args.path ? args.path : process.cwd();
    const effectiveLimit = Math.max(1, Math.floor(args.limit ?? DEFAULT_FIND_LIMIT))

    if (!(await pathExists(searchPath))) {
      return {
        content: `Path not found ${searchPath}`,
        isError: true
      }
    }

    try {
      const fdpath = await ensureTool("fd")
      if (!fdpath) {
        return {
          content: "fd is not availalble and could be not downloaded",
          isError: true
        }
      }
      const fdArgs: string[] = ["--glob", "--color=never", "--hidden"]

      // search for .git folder inside the path. if not exists then push --no-require-git which takes .gitignore consideration 
      // and ignores files like node_modules. /dist etc. if .git is present. then .gitignore is automatically takes in consideration by fd tool
      let insideGitRepo = false;
      for (let current = searchPath; ;) {
        if (await pathExists(path.join(current, ".git"))) {
          insideGitRepo = true;
          break;
        }
        // else cahgne the current dir. 
        const parent = path.dirname(current) // goes one folder outisde to parent folder if .git not found
        if (parent == current) break; // no .git found
        current == parent
      }

      if (!insideGitRepo) fdArgs.push("--no-require-git")
      fdArgs.push("--max-results", String(effectiveLimit + 1));

      let effectivePattern = args.pattern;
      if (args.pattern.includes("/")) {
        fdArgs.push("--full-path") // without this if the patter nis utils/login.js then it literraly search for file like utils/login.js
        // instead of searching inside utils/ folder. this flag fixes it
        // src/**/*.ts a pattern like this may need a prefix liks '**/' to match withing full path
        if (!args.pattern.startsWith("/") && !args.pattern.startsWith("**/") && args.pattern !== "**") {
          effectivePattern = `**/${args.pattern}`
        }

        // On Windows, fd uses native path separators, so the next line changes each / in the glob to [/\\]. on other platform pattern is remain unchanged
        if (process.platform === "win32")
          effectivePattern = effectivePattern.replaceAll("/", String.raw`[/\\]`);
      }

      fdArgs.push("--", effectivePattern, searchPath);

      // stdio tells how parent process interact with spawed process
      //                                      stdinput -ignore, stidout- pipe, stderr-pipe 

      return new Promise((resolve) => {
        const child = spawn(fdpath, fdArgs, { stdio: ["ignore", "pipe", "pipe"] })
        const rl = createInterface({ input: child.stdout });


        const cleanup = () => { rl.close() }

        const storedResult: string[] = [];
        let resultLimitReached = false;
        let resultCount = 0;
        let outputBytes = 0;
        let stderr = ""

        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        rl.on("line", (rawLine) => { // on each line this handler runs
          // remove the carriage return \r with empty "". and trims the space
          const line = rawLine.replace(/\r$/, "").trim();
          if (!line) return;

          if (resultCount == effectiveLimit) {
            resultLimitReached = true;
            return;
          }
          // else increase the result count and push to array
          resultCount++;
          if (outputBytes - 1 <= DEFAULT_MAX_BYTES) {
            storedResult.push(line)
          }
          outputBytes += Buffer.byteLength(line, "utf-8") + 1;
        });

        child.on("error", (error) => {
          cleanup()
          resolve({ content: `Failed to run fd: ${error.message}`, isError: true })
          return;
        })

        child.on("close", (code) => {
          if (code !== 0 && resultCount === 0) { // means child process finishes with some error while running fd command
            const errormsg = stderr.trim() || `fd exited with code: ${code}`
            resolve({ content: errormsg, isError: false })
            return;
          }
          if (resultCount === 0) {
            resolve({ content: "No files found matching pattern", isError: false })
            return;
          }

          // now truncate the output 

          const truncation = {
            ...truncateHead(storedResult.join("\n"), Number.MAX_SAFE_INTEGER),
            totalLines: resultCount,
            totalBytes: outputBytes - 1
          }
          let resultOutput = truncation.content;

          let notices: string[] = [];
          if (resultLimitReached) {
            notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
          }
          if (truncation.truncated) {
            notices.push(`${DEFAULT_MAX_BYTES} limit reached \n
                        details: ${truncation}`)
          }
          if (notices.length > 0) {
            resultOutput += `\n\n[${notices.join(". ")}]`
          }
          resolve({ content: resultOutput, isError: false })
          return;
        })
      })

    } catch {
      return {
        content: "Error occurred while accessing find tool",
        isError: true
      }
    }
  },
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
