import type { Tool } from "ai/types/tool";
import { resolve } from "node:path"

import { DEFAULT_MAX_BYTES } from "./utils/truncate";
import { readdir } from "node:fs/promises";

const DEFAULT_LS_LIMIT = 500; // no . for items to return max from ls search
export const lsTool: Tool = {
  name: "ls",
  description: `List directory contents. Returns entries sorted alphabetically, 
  with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LS_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first)`,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to list (default: current directory)"
      },
      limit: {
        type: "number",
        description: "Maximum number of entries to return (default: 500)"
      }
    },
    required: []
  },
  async execute(args) {
    try {
      if (args.path !== undefined && typeof args.path !== "string") {
        return { content: "path must be a string", isError: true };
      }
      if (args.limit !== undefined && typeof args.limit !== "number") {
        return { content: "limit must a number", isError: true };
      }
      const limit = args.limit ?? DEFAULT_LS_LIMIT

      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return { content: "limit must be a positive integer", isError: true };
      }

      const pathTosearch = resolve(process.cwd(), args.path ?? ".") // if given path. else run in current dir where agent is running
      //alternative to ls. as we dont want to spawn child_process
      const entries = await readdir(pathTosearch, { withFileTypes: true })

      // sort every entry in alphabeticall manner
      entries.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );

      const lines: string[] = []
      let truncated = false;
      let bytes = 0;
      for (const entry of entries) {
        if (lines.length >= limit) { // every line in array means each dir or file found in dir
          truncated = true;
          break;
        }

        // else
        // index.ts -> index.ts. or utils -> utils/
        const line = entry.name + (entry.isDirectory() ? "/" : "");
        const lineBytes = Buffer.byteLength(line, "utf8") + (lines.length ? 1 : 0);

        if (bytes + lineBytes > DEFAULT_MAX_BYTES) { // if this iteration is final contains more bytes than max bytes. break and truncate
          truncated = true;
          break;
        }
        lines.push(line);
        bytes += lineBytes;
      }

      let output = lines.join("\n") || "(empty directory)";

      if (truncated) {
        output += "\n\n[Output truncated. Narrow the directory or increase the limit]"
      }
      return { content: output, isError: false }
    } catch (e) {
      return {
        content: String(e),
        isError: true
      }
    }
  },


}
