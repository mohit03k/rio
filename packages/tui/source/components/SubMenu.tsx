import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import { ScrollList } from "ink-scroll-list";
import { SubMenuOption } from "./command/types.js";

export function filterSubmenu(input: string, options: SubMenuOption[]) {
	return options.filter(c => c.label.toLowerCase().includes(input.toLowerCase()))
}

export function Submenu({ title: _title, options, onSelect, onCancel, filterText }: {
	title: string,
	options: SubMenuOption[],
	onSelect: (value: SubMenuOption) => void,
	onCancel: () => void,
	filterText: string
}) {
	const listRef = useRef(null)
	const [selectedIndex, setSelectedIndex] = useState(0)

	const filteredOptions = filterSubmenu(filterText, options)
	const maxNameLength = Math.max(...filteredOptions.map(item => item.label.length), 0) + 8

	useInput((_input, key) => {
		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(prev - 1, 0))
		}
		if (key.downArrow) {
			setSelectedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
		}
		if (key.escape) {
			onCancel()
		}
		if (key.return && filteredOptions[selectedIndex]) {
			onSelect(filteredOptions[selectedIndex]) // selected command gets populated to InputPrompt comp
		}
	})


	if (filteredOptions.length === 0) {
		return (
			<Box borderStyle="round" height={3} borderColor="gray" paddingX={1}>
				<Text color="gray">No matching models</Text>
			</Box>
		)
	}

	return (
		<Box height={10} flexDirection="column" >
			<ScrollList ref={listRef} selectedIndex={selectedIndex}>
				{filteredOptions.map((option, i) => (
					<Box key={i} flexDirection="row">
						<Box width={maxNameLength}>
							<Text color={i === selectedIndex ? "green" : "#9e9e9e"}>
								{i === selectedIndex ? "> " : "  "}
								{option.label}
							</Text>
						</Box>
						<Box flexGrow={1}>
							<Text color={i === selectedIndex ? "green" : "gray"}>
								{option.value}
							</Text>
						</Box>
					</Box>
				))}
				<Box marginLeft={2} marginTop={1}>
					<Text color={"gray"}>
						Press esc to go back
					</Text>
				</Box>
			</ScrollList>
		</Box>
	)
}
