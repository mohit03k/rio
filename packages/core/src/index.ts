import type { Message } from "ai/types/provider";
import { runLoop } from "./agent/loop";
import { getProvider } from "ai/providers";
import { parseArgs } from "node:util";
import { bashTool, editTool, readTool, writeTool } from "tools";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    provider: { type: "string", default: "openrouter" },
    model: { type: "string" }
  }
})

const provider = getProvider(values.provider);
const model = values.model ?? provider.defaultModel;
const messages: Message[] = [{ role: "user", content: values.prompt! }]
const TOOLS = [readTool, writeTool, editTool, bashTool]

await runLoop({
  provider, messages, tools: TOOLS, model, onEvent(event) {

    if (event.type == "text_delta") {
      process.stdout.write(event.text)
    } else if (event.type == "tool_start") {
      console.log(`\n ${event.call.name}`)
    } else if (event.type == "tool_end") {
      const lines = event.result.split("\n").length;
      console.log("tool end")
      console.log(`\n ${event.isError ? event.result : lines}`)
    } else if (event.type == "turn_end") {
      console.log(`\n\n ${provider.name} ... ${model} .. input:${event.message.usage.input} ... output: ${event.message.usage.output} ... 
                  stopreason: ${event.message.stopReason}`)
    }
  },
})
