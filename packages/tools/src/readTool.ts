import { readFile } from "node:fs/promises"
import type { Tool } from "ai/types/tool"
import path, { resolve } from "node:path"
import { existsSync } from "node:fs";

export const readTool: Tool = {
  name: "read",
  description: "Read a file and return its contents",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file, relative to the current folder"
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed, optional)",
      },
      limit: {
        type: "number",
        description: "Max number of lines to read (optional, default: all)",
      },
    },
    required: ["path"]
  },
  async execute(args) {
    if (typeof args.path !== "string") {
      return {
        content: "Invalid argument: path must be strings.",
        isError: true,
      };
    }

    const filePath = resolve(args.path as string);
    if (!existsSync(filePath)) return { content: `File not found: ${filePath}`, isError: true }

    const raw = await readFile(path.resolve(process.cwd(), args.path), "utf8")
    const lines = raw.split("\n");
    // Drop the empty trailing element a final newline produces.
    if (lines.at(-1) === "") lines.pop();

    // offset. default 1
    const start = Math.max(0, ((args.offset as number) ?? 1) - 1); // e.g 3-2 = 2. start at 3rd item. or at 2 index on array
    const slice = lines.slice(start); // from beggening line to end of file

    // if limit given then slice till limit and send response. if not then default to all
    const limited = args.limit ? slice.slice(0, args.limit as number) : slice;

    // Prefix each line with its absolute line number, e.g. "11\tconst x = 1;".
    const numbered = limited.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
    return { content: numbered, isError: false }
  },
}
