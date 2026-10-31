import type { Tool, ToolResult } from "ai/types/tool";
import { DEFAULT_MAX_BYTES, truncateHead } from "./utils/truncate";
import { stat } from "node:fs/promises"
import { ensureTool } from "./utils/helper";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { readFile } from "node:fs/promises";

const DEFAULT_LIMIT = 100; // if more than 100 matches return limit 100 lines
export const GREP_MAX_LINE_LENGTH = 500; // Max chars per grep match line

//search for pattern in codebase. like endpoint or import or anything 
export const grepTool: Tool = {
  name: "grep",
  description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. 
      Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). 
        Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,

  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern (regex or literal string)"
      },
      path: { //optional
        type: "string",
        description: "Directory or file to search (default: current directory)"
      },
      glob: { // optional
        type: "string",
        description: "Filter files by glob pattern, e.g. '*.ts' , '**/*.spec.ts' or 'api_*.rs'"
      },
      /** By default ripgrep performs case sesitive . so if "Export" then it only return pattern containing E not "e"
       * but if ignoreCase is true then command will have -i flag which for  "Export" will include "export" ,"Export" and "EXPORT"
      */
      ignoreCase: { //optional
        type: "boolean",
        description: "Case-insensitive search (default: false)"
      },
      context: {
        type: "number",
        /** 
          * the agent searches for a pattern like processPayment(, the search result might return just that one line. 
          * But to actually understand how to use or fix it, the AI needs to see what happens right before and right after.
          * @example
          *   ```javascript
            line 40: const user = await auth.getCurrentUser();
            line 41: try {
            line 42:    const receipt = await processPayment(userId, cart.total);
            line 43:    return response.json({ success: true, receipt });
            line 44: } catch (error) {
          *```
          *
          * few lines of context, the AI now understands the entire execution flow.
        */
        description: "Number of lines to show before and after each match (default: 0)"
      },
      maxMatches: { //optional
        type: "number",
        description: `Maximum number of matches to return (default: ${DEFAULT_LIMIT})`
      }
    },
    required: ["pattern"]
  },
  async execute(args) {
    if (typeof args.pattern !== "string") {
      return {
        content: "Pattern should be of type string",
        isError: true
      }
    }

    if (
      (args.path !== undefined && typeof args.path !== "string") ||
      (args.glob !== undefined && typeof args.glob !== "string") ||
      (args.ignoreCase !== undefined && typeof args.ignoreCase !== "boolean")
    ) {
      return {
        content: "Invalid arguments: path and glob must be strings; ignoreCase must be a boolean.",
        isError: true,
      };
    }

    if (
      (args.maxMatches !== undefined && typeof args.maxMatches !== "number") ||
      (args.context !== undefined && typeof args.context !== "number")
    ) {
      return {
        content: "Invalid args: maxMatches and context must be number",
        isError: true
      }
    }

    const searchPath = args.path ? args.path : process.cwd();

    let isDir: boolean;
    try { // this shouldnt fail for process.cwd
      isDir = (await stat(searchPath)).isDirectory();
    } catch (e) { // no directory exists
      return {
        content: `Path not found: ${searchPath}`,
        isError: true
      }
    }

    try {
      // although the tool name is grep. we will be using ripgrep for faster results.
      // so we make sure the machine as ripgrep. if not then we install using the binary
      const ripgrepPath = await ensureTool("rg");
      if (!ripgrepPath) {
        return {
          content: "ripgrep (rg) is not available and could not be downloaded",
          isError: true
        }
      }

      const contextValue = args.context && args.context > 0 ? args.context : 0;
      const effectiveLimit = Math.max(1, args.maxMatches ?? DEFAULT_LIMIT); // if arg not given then fallback to default limit 100

      // converts /repo/lib/util/helper.ts -> util/helper.ts . to reduce excess text
      const formatPath = (filePath: string) => {
        if (isDir) {
          // src/utils/api/something.ts => /api/something.ts
          const relative = path.relative(searchPath, filePath); // relative path required from one dir to another dir
          if (relative && !relative.startsWith("..")) {
            return relative.replace(/\\/g, "/");
          }
        }

        // if the file path file example - app.ts
        return path.basename(filePath);

      }

      // build the ripgrep command
      // --json means output to json format instead plain text. --line-number includes line number. --hidden tells to search hidden files like .env .gitignore
      const rgArgs: string[] = ["--no-config", "--json", "--line-number", "--color=never", "--hidden"];

      // optionally add args if given in tool call args by llm
      if (args.ignoreCase) rgArgs.push("--ignore-case")
      if (args.glob) rgArgs.push("--glob", args.glob);
      // add the original pattern
      rgArgs.push("--", args.pattern, searchPath);

      return new Promise<ToolResult>((resolve) => {
        const child = spawn(ripgrepPath, rgArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        // create readline interface as every line input comes to child
        const rl = createInterface({ input: child.stdout });

        let stderr = "";
        let matchCount = 0;
        let matchLimitReached = false;
        let killedDueToLimit = false;
        let linesTruncated = false;
        // finalOutput lines. 
        const outputLines: string[] = [];
        const matches: Array<{ filePath: string; lineNumber: number; lineText?: string; }> = [];


        const formatBlock = async (filePath: string, lineNumber: number) => {
          const relativePath = formatPath(filePath);
          const lines = await getFileLines(filePath);
          if (!lines.length) return [`${relativePath}:${lineNumber}: (unable to read file)`];
          const block: string[] = [];
          // start of context value . lineNumber - contextValue;
          const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
          const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
          for (let current = start; current <= end; current++) {
            const lineText = lines[current - 1] ?? "";
            const sanitized = lineText.replace(/\r/g, "");
            const isMatchLine = current === lineNumber;
            // Truncate long lines so grep output stays compact.
            const { text, wasTruncated } = truncateLine(sanitized);
            if (wasTruncated) linesTruncated = true;
            if (isMatchLine) block.push(`${relativePath}:${current}: ${text}`); // if on this iteration the current line is matchLine.
            // then we use : . 
            // else - to seperate matchLine from context
            else block.push(`${relativePath}-${current}- ${text}`);
          }
          return block
        }

        const cleanup = () => {
          rl.close();
        };

        const stopChild = (dueToLimit = false) => {
          if (!child.killed) { // if the cihld process is not killed yet. kill it
            killedDueToLimit = dueToLimit;
            child.kill();
          }
        };

        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        rl.on("line", (line) => {
          if (!line.trim() || matchCount >= effectiveLimit) {// check to not add empty lines or more than limit
            return;
          }

          let event: any;

          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (event.type === "match") {
            const filePath = event.data?.path?.text;
            const lineNumber = event.data?.line_number;
            const lineText = event.data?.lines?.text;
            if (filePath && typeof lineNumber === "number")
              matches.push({ filePath, lineNumber, lineText });
            if (matchCount >= effectiveLimit) {
              matchLimitReached = true;
              stopChild(true);
            }
          }
        });


        child.on("error", (_err) => {
          // Failed to run ripgrep
          cleanup()
        });

        child.on("close", async (code) => {
          cleanup();

          if (!killedDueToLimit && code !== 0 && code !== 1) {
            resolve({
              content: `ripgrep failed (exit code ${code}): ${stderr}`,
              isError: true,
            });
            return; // return from this callback
          }
          if (matchCount == 0) {
            resolve({
              content: "No matches found",
              isError: false
            });
            return;
          }

          // if no error. and matches are found
          //then format the matches after streaming finishes
          for (const match of matches) {
            if (contextValue === 0 && match.lineText !== undefined) { // if no context values given
              const relativePath = formatPath(match.filePath);
              const sanitized = match.lineText
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "")
                .replace(/\n$/, "");
              const { text, wasTruncated } = truncateLine(sanitized);
              if (wasTruncated) linesTruncated = true;
              outputLines.push(`${relativePath}:${match.lineNumber}: ${text}`)
            } else { // if there was any context window number
              // so it means . for this match emit a small context around it
              const block = await formatBlock(match.filePath, match.lineNumber);
              outputLines.push(...block);
            }
          }

          const rawOutput = outputLines.join("\n"); // join lines from array to single string by \n
          const truncated = truncateHead(rawOutput);
          let output = truncated.content;

          // There is no line limit here because the match limit already capped rows.
          const notices = []; // notices for for truncation or match Limits
          if (matchLimitReached) {
            notices.push(`${effectiveLimit} matches limit reached`)
          }
          if (linesTruncated) {
            notices.push(`Some lines are truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`)
          }
          // add all notices
          if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
          resolve({
            content: output,
            isError: false
          })
          return;
        });
      });
    } catch {
      return {
        content: `Error occured while accessing ripgrep tool`,
        isError: true
      }
    }
  },
}


function truncateLine(line: string, maxChars: number = GREP_MAX_LINE_LENGTH): { text: string, wasTruncated: boolean } {
  if (line.length <= maxChars) { // if line length is smaller then grpre max length then dont truncate
    return { text: line, wasTruncated: false };
  }
  // else trucate the line
  return { text: `${line.slice(0, maxChars)}...[truncated]`, wasTruncated: true }
}

async function getFileLines(filePath: string) {
  let lines: string[] = []
  try {
    const content = await readFile(filePath, "utf8");
    lines = content.replace(/\r\n/g, "\n").split("\n");
    return lines
  } catch {
    return lines
  }

}
