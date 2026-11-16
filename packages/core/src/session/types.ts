import type { Message } from "ai/types/provider";

export type SessionHeader = { // created in starting of every converstaion chat or session
  type: "session"
  version: 1;
  id: string;
  cwd: string;
  provider: string; // openrouter, claude, openai, etc
  model: string; // qwen/qwen-3.8-27b
  createdAt: string;
}


// every message or line in jsonl is of this type
export type MessageEntry = {
  type: "message";
  id: string;
  timestamp: string;
  message: Message;
};

export type SessionEntry = SessionHeader | MessageEntry;

