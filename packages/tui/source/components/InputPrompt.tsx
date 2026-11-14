import { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { CommandMenu } from './command/index.js';
import { Submenu } from './SubMenu.js';
import type { Command, SubMenuOption, CommandContext } from './command/types.js';
import { allcommands } from './command/commands.js';

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

	// so Input Prompt file mainly becomes things to wire up
	// we pass all the context(functions) required by those commands to run


	const temp = useMemo(() => // gets all the commands
		allcommands(context)
		, [context])

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
			return
		}

		if (submenu && (key.return || key.upArrow || key.downArrow)) return;

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

			if (commandmenu && nextValue === "") {
				setCommandMenu(false);
			}

			return;
		}
		if (input && !key.ctrl && !key.meta) {
			if (input === "/" && value === "" && !submenu) {
				setCommandMenu(true);
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
						<Text inverse>{value[cursor] ?? " "}</Text>
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
			<Box paddingX={1}>
				<Text dimColor> {currentModel} </Text>
				<Text>• </Text>
				<Text bold>{process.cwd()}</Text>
			</Box>
		</>
	)
}
