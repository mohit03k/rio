import { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { CommandMenu } from './command/index.js';
import { Submenu } from './SubMenu.js';
import type { Command, SubMenuOption, CommandContext } from './command/types.js';
import { allcommands } from './command/commands.js';
import { FileMenu } from './FileMenu.js';

const PROMPT = "> "

type InputPromptProps = {
	context: CommandContext;
	currentModel: string;
	onSubmit: (prompt: string) => Promise<void>;
	isRunning: boolean;
	onAbort: () => void
}

export const InputPrompt = ({
	context,
	currentModel,
	onSubmit,
	isRunning,
	onAbort,
}: InputPromptProps) => {
	const { exit } = useApp();
	const [value, setValue] = useState('');
	// to move cursor with keys in input
	const [cursor, setCursor] = useState(0);
	const [commandmenu, setCommandMenu] = useState(false);
	const [submenu, setSubmenu] = useState<{ title: string, options: SubMenuOption[], onSelect: (value: string) => void } | null>(null);
	const [fileStart, setFileStart] = useState<number | null>(null);

	const fileQuery =
		fileStart === null ? "" : value.slice(fileStart + 1, cursor);

	const isFiles =
		fileStart !== null &&
		value[fileStart] === "@" &&
		cursor > fileStart &&
		!/\s/.test(fileQuery);

	// so Input Prompt file mainly becomes things to wire up

	// we pass all the context(functions) required by those commands to run


	const temp = useMemo(() => // gets all the commands
		allcommands(context)
		, [context])

	function moveCursorVertically(direction: -1 | 1) {
		const lines = value.split("\n");
		const beforeCursor = value.slice(0, cursor).split("\n");
		const row = beforeCursor.length - 1;
		const column = beforeCursor[row]!.length;
		const targetRow = row + direction;

		if (targetRow < 0 || targetRow >= lines.length) return;

		let targetStart = 0;
		for (let index = 0; index < targetRow; index++) {
			targetStart += lines[index]!.length + 1; // Include the newline.
		}

		// A shorter line places the cursor at its end.
		setCursor(targetStart + Math.min(column, lines[targetRow]!.length));
	}

	function onHandleSelect(item: Command) {
		setCommandMenu(false) // close the commandmenu
		setValue('')
		setCursor(0)
		if (!item.action) return
		if (item.action.kind === 'run') {
			item.action.run()
		} else {
			setSubmenu({ title: item.name, options: item.action.options, onSelect: item.action.onSelect })
		}
	}
	function handleFileSelect(filepath: string) {
		if (fileStart === null) return;

		const reference = `@${filepath} `;

		setValue(
			value.slice(0, fileStart) +
			reference +
			value.slice(cursor),
		);

		setCursor(fileStart + reference.length);
		setFileStart(null);
	}

	useInput((input, key) => {
		const isCtrlC = key.ctrl && input === "c";

		if (isRunning) { // if loop is running only then
			if (key.escape || isCtrlC) {
				onAbort();
			}
			return;
		}


		if (key.ctrl && input === 'c') {
			if (commandmenu) {
				setCommandMenu(false)
				setValue("")
				setCursor(0);
			} else {
				exit()
			}
			return
		}

		if (key.escape) {
			if (commandmenu) setCommandMenu(false)
			if (submenu) setSubmenu(null)
			setFileStart(null);
			return
		}

		if (submenu && (key.return || key.upArrow || key.downArrow)) return;
		if (
			isFiles &&
			(key.return || key.upArrow || key.downArrow)
		) {
			return;
		}

		// to move vertically between lines using up/down
		if (key.upArrow || key.downArrow) {
			if (!commandmenu) moveCursorVertically(key.upArrow ? -1 : 1);
			return;
		}

		// to enter newline with ctrl+j
		if ((key.ctrl && input === "j") || input === "\n") {
			setValue(
				value.slice(0, cursor) + "\n" + value.slice(cursor),
			);
			setCursor(cursor + 1);
			return;
		}

		if (key.return) {
			// CommandMenu handles command selection itself.
			if (commandmenu) return;

			const prompt = value.trim();

			if (prompt) {
				setValue("");
				setCursor(0)
				void onSubmit(prompt);
			}

			return;
		}

		if (key.leftArrow) {
			setCursor(position => Math.max(0, position - 1));
			return;
		}

		if (key.rightArrow) {
			setCursor(position => Math.min(value.length, position + 1));
			return;
		}

		if (key.backspace || key.delete) { // if deleting the input value
			if (cursor === 0) return;

			const nextValue =
				value.slice(0, cursor - 1) + value.slice(cursor);

			setValue(nextValue);
			setCursor(cursor - 1);

			if ((commandmenu && nextValue === "")) {
				setCommandMenu(false);
			}

			return;
		}
		if (input && !key.ctrl && !key.meta) {
			if (input === "/" && value === "" && !submenu) {
				setCommandMenu(true);
			}
			if (input === "@" && !submenu && !commandmenu) {
				setFileStart(cursor);
			}

			// finally set the value
			setValue(
				value.slice(0, cursor) + input + value.slice(cursor),
			);
			// and set the cursor. prev lenght of cursor + length of input
			setCursor(cursor + input.length);
		}
	},) // this hook is only active if loginOpen is not opened

	return (
		<>
			<Box
				borderStyle="round"
				borderLeft={false}
				borderRight={false}
				borderColor="gray"
			>
				{value ? ( // this is the live input prompt user currently typing
					<Text>
						{PROMPT}
						{value.slice(0, cursor)}
						<Text inverse>{value[cursor] === "\n" ? " " : value[cursor] ?? " "}</Text>
						{value[cursor] === "\n" ? "\n" : ""}
						{value.slice(cursor + 1)}
					</Text>
				) : (
					<Text color="gray">
						{PROMPT}
						<Text inverse>E</Text>
						xplain the code base
					</Text>
				)}
			</Box>
			{commandmenu && <CommandMenu inputText={value} commands={temp} onSelect={onHandleSelect} />}
			{submenu && (
				<Submenu
					title={submenu.title}
					options={submenu.options}
					onSelect={(v) => { submenu.onSelect(v.value); setSubmenu(null) }}
					onCancel={() => { setSubmenu(null) }}
					filterText={value}
				/>
			)}
			{isFiles && (
				<FileMenu
					key={fileQuery}
					query={fileQuery}
					onSelect={handleFileSelect}
				/>
			)}
			<Box paddingX={1}>
				<Text dimColor> {currentModel} </Text>
				<Text>• </Text>
				<Text bold>{process.cwd()}</Text>
			</Box>
		</>
	)
}
