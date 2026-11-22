import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Message } from "ai/types/provider";
import type {
  MessageEntry,
  SessionEntry,
  SessionHeader,
} from "./types";
import { getSessionDirectory } from "./path";

export class SessionStore {
  private constructor(
    public readonly filepath: string,
    public readonly header: SessionHeader,
    private entries: MessageEntry[],
    private hasWrittenFile: boolean,
  ) { }

  static create(
    cwd: string,
    provider: string,
    model: string,
  ): SessionStore {
    const directory = realpathSync(cwd);

    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: crypto.randomUUID(),
      cwd: directory,
      provider,
      model,
      createdAt: new Date().toISOString(),
    };

    const filepath = join(
      getSessionDirectory(directory),
      `${header.id}.jsonl`,
    );

    // Create the actual file only when the first message arrives. currently we just only returning the class
    return new SessionStore(filepath, header, [], false);
  }

  static load(filepath: string): SessionStore {
    const absolutePath = resolve(filepath);
    const content = readFileSync(absolutePath, "utf8");

    // Refuse a potentially interrupted write rather than append onto it.
    if (!content.endsWith("\n")) { // if final line in .jsonl doesnt ends with \n
      throw new Error("Session file has an incomplete final line.");
    }

    const lines = content.trimEnd().split("\n");

    // These assertions describe Rio's own file format.
    const header = JSON.parse(lines[0]!) as SessionHeader; // parse the very first line of .jsonl which is header

    if (header.type !== "session" || header.version !== 1) {
      throw new Error("Unsupported session format.");
    }

    const entries: MessageEntry[] = [];

    for (const line of lines.slice(1)) { // starts after header line
      const entry = JSON.parse(line) as SessionEntry;

      if (entry.type !== "message") {
        throw new Error("Unexpected session entry.");
      }

      entries.push(entry);
    }

    return new SessionStore( // return the session with all entries. so tui will reconstruct the chat
      absolutePath,
      header,
      entries,
      true,
    );
  }

  static list(cwd: string): string[] {
    const directory = getSessionDirectory(cwd);

    if (!existsSync(directory)) {
      return [];
    }

    return readdirSync(directory)
      .filter(name => name.endsWith(".jsonl"))
      .map(name => join(directory, name))
      .sort(
        (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs, // newest to oldest sorted chatts
      );
  }

  getMessages(): Message[] {
    return this.entries.map(entry => entry.message);
  }

  appendMessage(message: Message): void {
    if (!this.hasWrittenFile) { // if file is not written with any message
      mkdirSync(dirname(this.filepath), { recursive: true }); // make the dir

      writeFileSync( // write the session file with first header message
        this.filepath,
        JSON.stringify(this.header) + "\n",
        { flag: "wx" }, // creates the file only if it doesnt exist
      );

      this.hasWrittenFile = true;
    }

    const entry: MessageEntry = {
      type: "message",
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message,
    };

    appendFileSync(
      this.filepath,
      JSON.stringify(entry) + "\n",
    );

    // Update memory only after the write succeeds.
    this.entries.push(entry);
  }

  repairInterruptedTools(): void { // if the last message was tool call and agent loop was interrupted before result was recorded then append that 
    // as well in session
    const pending = new Map<string, { id: string; name: string }>();

    for (const { message } of this.entries) {
      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "tool_call") {
            pending.set(block.id, {
              id: block.id,
              name: block.name,
            });
          }
        }
      }

      if (message.role === "toolResult") {
        pending.delete(message.toolCallId);
      }
    }

    for (const call of pending.values()) {
      this.appendMessage({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        isError: true,
        content:
          "Execution was interrupted before a result was recorded. " +
          "The outcome is unknown. Inspect current state before retrying.",
      });
    }
  }
}
