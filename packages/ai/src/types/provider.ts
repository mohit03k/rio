import type { Tool } from "./tool";

export type UserMessage = { role: "user"; content: string }

export type TextBlock = { type: "text", text: string }

export type ToolCallBlock = {
  type: "tool_call",
  id: string,
  name: string,
  arguments: Record<string, unknown>// JSON ; parse it before passing args in function execution
}

export type ContentBlock = TextBlock | ToolCallBlock // content returned from the assistant (llm) can be of two type
// either normal text content or tool call with call id 

export type AssistantMessage = {
  role: "assistant";
  content: ContentBlock[];
  usage: Usage;
  stopReason: StopReason
}

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;                // links the result to the ToolCall it answers
  toolName: string;
  content: string;   // what the LLM sees
  isError?: boolean;
};

export type StopReason = "length" | "stop" | "toolUse";

export type Usage = { input: number; output: number }

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export interface StreamOptions {
  model: string
  messages: Message[]
  system?: string
  tools: Tool[]
  signal?: AbortSignal;
}

// while iterating on the openi ai provider the yield will either return text_delta or done . as defined in openAi compatible
export type StreamEvent = {
  type: "text_delta",
  delta: string
} |
{
  type: "done",
  message: AssistantMessage
}

export interface Provider {
  name: string;
  defaultModel: string;
  stream(opts: StreamOptions): AsyncIterable<StreamEvent>
}
