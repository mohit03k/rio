// the main agent loop

import type { AssistantMessage, Message } from "ai/types/provider";
import type { AgentOptions } from "./types";
import type { ToolResult } from "ai/types/tool";


export async function runLoop({
  model,
  /**
  * an already-running tool won’t stop immediately, because tool.execute() doesn’t receive the signal yet. 
  * Cancellation will take effect after that tool finishes.
  */
  signal,
  tools, messages, system, maxTurns, provider, onEvent }: AgentOptions) {
  let iterations = 0;
  const push = (message: Message) => {
    messages.push(message)
    onEvent({ type: "message", message: message })
  }

  // run the agent Loop for max turns or 25 max before throwing error
  while (iterations < (maxTurns ? maxTurns : 25)) {
    iterations++;
    let assistant: AssistantMessage | undefined;

    // on every turn check if operation is aborted
    signal?.throwIfAborted();
    for await (const event of provider.stream({ model, tools, messages, system, ...(signal ? { signal } : {}) })) {
      signal?.throwIfAborted();
      if (event.type == "text_delta") { // if the the event type is text delta just run onEvent
        onEvent({ type: "text_delta", text: event.delta }) // callback function 
      } else { // or else it should "done" with last assistant message
        assistant = event.message
      }
    }
    // this checks if the cancellation happened after the streaming is stopped
    signal?.throwIfAborted();

    if (!assistant) throw new Error("no assistant message for tool call");
    push(assistant);
    onEvent({ type: "turn_end", message: assistant });

    if (assistant.stopReason != "toolUse") { // if no tool use then return. this means the llm assistant 
      // returned either "stop"(if stream response stopped in between) or "length" (the chat stream is finished)
      return;
    }

    // else run all the tool in loop in content block of assistant message
    for (const block of assistant.content) {
      if (block.type != "tool_call") continue; // if no tool call continue
      signal?.throwIfAborted()

      onEvent({ type: "tool_start", call: block })

      let res: ToolResult;
      try {
        const tool = tools.find((t) => t.name === block.name);
        if (!tool) throw new Error(`unkown tool name from LLM ${block.name}`)
        res = await tool.execute(block.arguments);
      } catch (e) { // some error occured while executing tool. this shouldnt run generally as we do return error in tool calling
        signal?.throwIfAborted();

        res = {
          content: `Error while tool call ${e}`,
          isError: true
        }
      }
      onEvent({ type: "tool_end", call: block, result: res.content, isError: res.isError })
      // after tool call push it to messages array
      push({ role: "toolResult", toolCallId: block.id, toolName: block.name, content: res.content })
    }
    // after pushing tools result to messages the loop will run again and based on response if its tools use or "done"
  }
  throw new Error(`stopped after maxTurns ${maxTurns ? maxTurns : 25}`)
}
