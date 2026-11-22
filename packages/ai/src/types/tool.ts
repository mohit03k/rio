import type OpenAI from "openai";

export type ToolResult = {
  content: string; // what llm sees
  isError: boolean;
  isCancelled?: boolean;
}
export type ToolContext = {
  signal?: AbortSignal;
};

export type Tool = {
  name: string;
  description: string;
  parameters: OpenAI.FunctionParameters;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>;
}
