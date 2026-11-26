import { Box, Text, useInput } from "ink"
import { useState } from "react";

interface Filemenuprops {
	query: string; // the text beign searched
	onSelect: (filepath: string) => void // onSelect recived the chosen path
}

// Temporary: replace with project file discovery afterward.
const FILES = [
	"packages/core/src/session/SessionStore.ts",
	"packages/tools/src/utils/helper.ts",
	"packages/tui/source/app.tsx",
];

export const FileMenu = ({ query, onSelect }: Filemenuprops) => {
	const [selected, setSelected] = useState(0)

	const matches = FILES.filter(path => path.toLowerCase().includes(query.toLowerCase()));

	// Filtering can leave the old selection outside the new list.
	const index = Math.max(0, Math.min(selected, matches.length - 1));

	useInput((_input, key) => {
		if (key.upArrow) {
			setSelected(Math.max(0, index - 1));
		}

		if (key.downArrow) {
			setSelected(Math.min(matches.length - 1, index + 1));
		}

		if (key.return && matches[index]) {
			onSelect(matches[index]);
		}
	});

	return (
		<Box flexDirection="column" borderStyle="round">
			{matches.length === 0 ? (
				<Text dimColor>No matching files</Text>
			) : (
				matches.map((filepath, i) => (
					<Text key={filepath} color={i === index ? "green" : "gray"}>
						{i === index ? "> " : "  "}
						{filepath}
					</Text>
				))
			)}
		</Box>
	);
}
