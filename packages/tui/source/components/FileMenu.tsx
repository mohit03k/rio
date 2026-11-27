import { Box, Text, useInput } from "ink"
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { useEffect, useState } from "react";
import { ensureTool } from "tools/src/utils/helper.ts";

interface Filemenuprops {
	query: string; // the text beign searched
	onSelect: (filepath: string) => void // onSelect recived the chosen path
}


const runFile = promisify(execFile); // execFile lets u run binary or script without spawning a shell

export const FileMenu = ({ query, onSelect }: Filemenuprops) => {
	const [selected, setSelected] = useState(0)
	const [files, setFiles] = useState<string[]>([])
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(true) // on first load true. then successfull useEffect makes it false

	useEffect(() => {
		const controller = new AbortController();

		async function loadFiles() {
			try {
				const fd = await ensureTool("fd");

				if (controller.signal.aborted) return;
				if (!fd) throw new Error("fd is unavailable")

				const { stdout } = await runFile(fd, [
					"--type", "f", // lists files
					"--type", "d", // list directories also
					"--hidden",
					"--exclude", ".git",
					"--max-results", "1000",
					".",  // means search pattern
					".",  // means current directory
				], { cwd: process.cwd(), signal: controller.signal, maxBuffer: 8 * 1024 * 1024 })
				if (controller.signal.aborted) return;

				setFiles(
					// .\src\index.js	-> src\index.js
					stdout.split(/\r?\n/).filter(Boolean).map(filepath => filepath.replace(/^\.[/\\]/, "")),
				);


			} catch (e) {
				if (!controller.signal.aborted) {
					setError(
						e instanceof Error ? e.message : String(e),
					);
				}
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false)
				}
			}
		}

		void loadFiles()

		// stop fd if user closes menu
		return () => controller.abort(); // this runs just before FileMenu unmounts
	}, [])

	// Reset selection when filtering changes.
	useEffect(() => {
		setSelected(0);
	}, [query]);

	// This shows at most 20 matching paths so the menu doesn’t fill the terminal.
	const matches = files
		.filter(filepath =>
			filepath.toLowerCase().includes(query.toLowerCase()),
		)
		.slice(0, 8);

	// Filtering can leave the old selection outside the new list.
	// selected to
	const index = Math.max(0, Math.min(selected, matches.length - 1));

	useInput((_input, key) => {
		if (key.upArrow && selected === 0) { // if very first value is selected and user preses up arrow. move the selection to very end of list
			setSelected(Math.max(0, matches.length - 1));
		} else if (key.upArrow) {
			setSelected(Math.max(0, index - 1));
		}

		if (key.downArrow && selected === matches.length - 1) { // if very last value and down press. move to very top
			setSelected(Math.min(matches.length - 1, 0)); // on first down press. increaes the index from 0 to 1
		} else if (key.downArrow) {
			setSelected(Math.min(matches.length - 1, index + 1)); // on first down press. increaes the index from 0 to 1
		}

		// on select
		if (key.return && matches[index]) {
			onSelect(matches[index]);
		}
	});
	if (loading) {
		return <Text dimColor>Loading files...</Text>;
	}

	if (error) {
		return <Text color="red">{error}</Text>;
	}

	return (
		<Box flexDirection="column" borderStyle="round" height={10}>
			{matches.length === 0 ? (
				<Text dimColor>No matching files</Text>
			) : (
				matches.map((filepath, i) => (
					<Text key={filepath} wrap="truncate" color={i === index ? "green" : "gray"}>
						{i === index ? "> " : "  "}
						{filepath}
					</Text>
				))
			)}
		</Box>
	);
}
