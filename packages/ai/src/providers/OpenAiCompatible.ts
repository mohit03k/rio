import OpenAI from "openai"
import type { ContentBlock, Message, Provider, StopReason, Usage } from "../types/provider";


function toOpenAi(messages: Message[]) { // convert the message sent from harnes/agent to llm
  return messages.map((m): OpenAI.ChatCompletionMessageParam => {
    if (m.role == "user") {
      return { role: m.role, content: m.content }
    };

    if (m.role == "assistant") {
      const text_blocks = m.content.filter((b) => b.type == "text");
      const text = text_blocks.map((t) => t.text).join("");
      const calls = m.content.filter((b) => b.type == "tool_call");
      const tool_calls = calls.length ? calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.arguments) }
      }))
        : undefined;

      return {
        role: m.role,
        content: text,
        tool_calls: tool_calls
      };
    }
    // else it could be tool call result from our code
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
  })
}

// name - anthropic, groq, gemini, openrouter etc
export function createOpenAiCompatible(name: string, apiKey: string, baseUrl: string, defaultModel: string): Provider { // should return a provider which we will define in types

  const openai = new OpenAI({
    apiKey: apiKey, // Your provider API key
    baseURL: baseUrl  // provider API endpoint
  });

  return {
    name,
    defaultModel,
    async *stream({ model, messages, system, tools = [] }) { // if not tools passed defaults to empty array

      const chat = toOpenAi(messages);
      const stream = await openai.chat.completions.create({
        model: model,
        messages: system ? [{ "role": "system", content: system }, ...chat] : chat, // if system prompt exist thne append before any message.
        stream: true,
        tools: tools.length ? tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters }
        })) : undefined,
        stream_options: { include_usage: true },
        max_completion_tokens: 8192
      });

      let text = "";
      const calls: { id: string; name: string; args: string }[] = [] // each tool call from llm response contains id name of tool and args
      let usage: Usage = { input: 0, output: 0 }
      let stopReason: StopReason = "stop"; // default to stop if llm failed to return full response
      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta.content) {
          text += chunk.choices[0]?.delta.content;
          yield { // everytime outer fuction yeild on this. he gets object below
            type: "text_delta", delta: chunk.choices[0]?.delta.content
          }
        }

        // this array of tool_calls is array of partial updates and not full functinal tool calls
        // a chunk may have full tool call or partial update or no call
        // each update has an in index(number) so u know which call it belongs to. function.arguments arrives in pieces so append each arg 
        // to 
        for (const tool_call of chunk.choices[0]?.delta.tool_calls ?? []) {
          // if this the first all add the index number as id and name and args to the calls array
          calls[tool_call.index] ??= {// "??=" means only assign if the if the value of this is null or undefined. this means only for first time
            id: tool_call.id ?? `${tool_call.index}`,
            name: tool_call.function?.name ?? "", // for the first time tool call there should be name and args
            args: ""
          }
          calls[tool_call.index]!.args += tool_call.function?.arguments ?? ""
        }

        if (chunk.choices[0]?.finish_reason === "length") { // if this check ran means the chat stream is finished
          stopReason = "length"
        } else if (chunk.choices[0]?.finish_reason == "tool_calls") { // if llm stream stopped due to tool calls then stop and execute the tool
          stopReason = "toolUse"
        };
        if (chunk.usage) {
          usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens }
        };
      }

      // the stop reason could either be text block array or tool call
      // so we put text to it. 
      const content: ContentBlock[] = text ? [{ type: "text", text }] : []
      // if there was any tool call then the final yeild content is ToolCall block
      for (const call of calls) {
        if (!call) continue;

        let args = {};

        // if last chunk was stop due to length due to max completion_tokens 
        // and some arg is {"city": "Newyo. which might fail on parsing. so we add try catch
        try {
          args = call.args ? JSON.parse(call.args) : {};
        } catch {
          console.warn(`skipping tool call ${call.name} because stopped on half args due to length reason of max tokens`, call.args)
          continue;
        }
        console.log("a call", call);
        // finally json .parse to convert json string to js object. or if empty then empty object
        content.push({ type: "tool_call", id: call.id, name: call.name, arguments: args })
      }

      yield {
        type: "done",
        message: { role: "assistant", content: content, usage, stopReason: stopReason }
      }
    }
  }
}


