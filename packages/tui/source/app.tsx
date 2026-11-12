import { Box, Text, useApp } from "ink";
import BigText from "ink-big-text";
import { useMemo, useRef, useState } from "react";

import type { Message } from "ai/types/provider";
import { getProvider } from "ai/providers";
import { runLoop } from "core/agent/loop";
import { readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool } from "tools";
import { InputPrompt } from "./components/InputPrompt.js";
import { InputHistory } from "./components/InputHistory.js";
import { LoginPrompt } from "./components/LoginPrompt.js";
import { loadApiKey, saveApiKey } from "./components/utils/auth.js";

const TOOLS = [readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool];

type entryKind = "user" | "assistant" | "tool" | "error";

type ChatEntry = { // to show in tui. what currently the agent is doing high level
	id: string;
	kind: entryKind;
	text: string;
};

export default function App() {
	const { exit } = useApp();
	const [currentModel, setCurrentModel] = useState("qwen/qwen3.8-27b");
	const [loginOpen, setLoginOpen] = useState(false);
	const [entries, setEntries] = useState<ChatEntry[]>([]);
	const [isRunning, setIsRunning] = useState(false);

	// Model history includes structured tool calls and results, unlike display entries.
	const messages = useRef<Message[]>([]);
	const running = useRef(false);

	function addEntry(kind: entryKind, text: string) {
		const id = crypto.randomUUID();
		setEntries(previous => [...previous, { id, kind, text }]);
		return id;
	}

	function updateEntry(id: string, text: string) {
		setEntries(previous => previous.map(entry =>
			entry.id === id ? { ...entry, text } : entry,
		));
	}

	async function handleSubmit(prompt: string) { // on input prompt submit run this handler
		const text = prompt.trim();
		if (!text || running.current) return; // if the prompt is somehow empty or currently the loop is running. dont let user submit another

		// The ref prevents a second submission before React renders the busy state.
		running.current = true;
		setIsRunning(true);
		// add entry ouf user sent the prompt on submit
		addEntry("user", text);

		// Commit only a successful run, avoiding incomplete tool calls after errors.
		// example on first user prompt this will be
		// {role: "user", content: "prompt from user"}
		const nextMessages: Message[] = [...messages.current, { role: "user", content: text }];
		let assistantId: string | undefined;
		let assistantText = "";
		const toolEntries = new Map<string, string>();

		try {
			// if not api key in .env. load from homedir .rio/auth.json and set in .env
			if (!process.env.OPENROUTER_API?.trim()) {
				const savedKey = await loadApiKey();
				if (savedKey) process.env.OPENROUTER_API = savedKey;
			}

			await runLoop({
				provider: getProvider("openrouter"),
				model: currentModel,
				tools: TOOLS,
				messages: nextMessages, // the loop directly push the tool call assistant messages. directly this nextMessages array
				onEvent(event) {
					if (event.type === "text_delta") {
						assistantText += event.text; // llm assistant sent back some text
						// every single run assistantId is added to entries. and on every agent event on same run updates the assistantText
						if (assistantId === undefined) {
							assistantId = addEntry("assistant", assistantText);
						} else {
							updateEntry(assistantId, assistantText);
						}
					} else if (event.type === "turn_end") {
						const finalText = event.message.content // on turn end of llm response join all the text
							.filter(block => block.type === "text")
							.map(block => block.text)
							.join("");

						if (assistantId !== undefined) {
							updateEntry(assistantId, finalText);
						} else if (finalText) {
							addEntry("assistant", finalText);
						}

						// A model turn can end before tools run; the agent is still busy.
						assistantId = undefined;
						assistantText = "";
					} else if (event.type === "tool_start") { // some tool was called
						const id = addEntry("tool", `${event.call.name}: running...`);
						toolEntries.set(event.call.id, id);
					} else if (event.type === "tool_end") { // tool calling ended
						// get the particular tool call that was in running phase. to update its entry with status
						const id = toolEntries.get(event.call.id);
						if (id !== undefined) {
							const status = event.isError ? "failed" : "done";
							updateEntry(id, `${event.call.name}: ${status}\n${event.result}`);
						}
					}
				},
			});
			// Then this line saves that array as the history for future prompts
			// then the second prompt from user gets appended to this array so the model remembers conversation
			// if runLoop throws erros then this assign is skipped . keeping only previous history before this loop run. and error is showed in tui
			messages.current = nextMessages;
		} catch (error) {
			addEntry("error", error instanceof Error ? error.message : String(error));
		} finally {
			running.current = false;
			setIsRunning(false);
		}
	}

	const context = useMemo(() => ({
		exit,
		openLogin: () => setLoginOpen(true),
		newSession: () => {
			if (running.current) return;
			messages.current = [];
			setEntries([]);
		},
		selectModel: (model: string) => {
			if (!running.current) setCurrentModel(model);
		},
	}), [exit]);

	async function handleLoginSubmit(apiKey: string) {
		await saveApiKey(apiKey);
		process.env.OPENROUTER_API = apiKey;
		setLoginOpen(false);
	}

	return (
		<Box flexDirection="column">
			<Box marginLeft={1}>
				<BigText text="Rio" font="tiny" colors={["gray"]} />
			</Box>
			{entries.map((entry) => {
				const lines = entry.text.trimEnd().split("\n");
				const firstLine = lines[0];
				const outputLines = lines.slice(1);

				const firstOutputLine = outputLines.find(
					(line) => line.trim() !== ""
				);
				const remaining = Math.max(0, outputLines.length - (firstOutputLine ? 1 : 0));

				return entry.kind === "user" ? (
					<InputHistory key={entry.id} prompt={entry.text} />
				) : (
					<Box key={entry.id} flexDirection="column" marginBottom={1}>
						{entry.kind === "error" && <Text bold color={"red"}>
							{entry.kind}
						</Text>}
						{entry.kind === "tool" ? (
							<Box flexDirection="column">
								<Text bold color="white">{firstLine}</Text>

								{firstOutputLine !== undefined && (
									<Box paddingLeft={2} flexDirection="column">
										<Text dimColor wrap="truncate">
											{firstOutputLine}
										</Text>

										{remaining > 0 && (
											<Text dimColor>+{remaining} lines</Text>
										)}
									</Box>
								)}
							</Box>
						) : (
							<Text>{entry.text}</Text>
						)}
					</Box>
				);
			})
			}
			{isRunning && <Text dimColor>Working...</Text>}
			{
				loginOpen ? (
					<LoginPrompt onSubmit={handleLoginSubmit} onCancel={() => setLoginOpen(false)} />
				) : (
					<InputPrompt context={context} currentModel={currentModel} onSubmit={handleSubmit} isRunning={isRunning} />
				)
			}
		</Box >
	);
}
