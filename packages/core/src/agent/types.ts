import type { AssistantMessage, Message, Provider, ToolCallBlock } from "ai/types/provider";
import type { Tool } from "ai/types/tool";

// the agent can either have these on loop. simple text delta. tool start, tool_end , turn_end when loop about to end and message
export type AgentEvent = { type: "text_delta", text: string } |
{ type: "tool_start", call: ToolCallBlock } |
{ type: "tool_end", call: ToolCallBlock, result: string, isError: boolean } |
{ type: "turn_end", message: AssistantMessage } | // the final llm stream messgae containing stop reason usage etc.
{ type: "message", message: Message } // this is either user sent message, tool call result, or assistant message sent back to llm


export type AgentOptions = { // will be passed as args in runAgent function
  provider: Provider;
  signal?: AbortSignal; // gets the signal whether controller aborted or not readonly
  messages: Message[];
  system?: string;
  tools: Tool[];
  model: string;
  maxTurns?: number;
  onEvent: (event: AgentEvent) => void; // for showing cli what event currently agent is running 
}
