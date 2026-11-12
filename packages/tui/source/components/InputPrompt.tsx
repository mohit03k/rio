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
}

export const InputPrompt = ({
	context,
	currentModel,
	onSubmit,
	isRunning,
}: InputPromptProps) => {
	const { exit } = useApp();
	const [value, setValue] = useState('');
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
		if (!item.action) return
		if (item.action.kind === 'run') {
			item.action.run()
		} else {
			setSubmenu({ title: item.name, options: item.action.options, onSelect: item.action.onSelect })
		}
	}

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			if (commandmenu) {
				setCommandMenu(false)
				setValue("")
			} else {
				exit()
			}
			return
		}
		if (isRunning) return;

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
				void onSubmit(prompt);
			}

			return;
		}

		if (input === "/" && value === "" && !submenu) {
			setCommandMenu(true)
			setValue(prev => prev + input)
			return
		}

		if (commandmenu && key.delete) {
			setValue(prev => prev.slice(0, -1))
			if (value.slice(-1) == "/" && value.length == 1) {
				setCommandMenu(false)
			}
			return
		}
		if (key.backspace || key.delete) {
			setValue(prev => (prev.length > 0 ? prev.slice(0, -1) : prev))
			return
		}
		if (input && !key.ctrl && !key.meta) {
			setValue(prev => prev + input)
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
						{value}<Text inverse> </Text></Text>
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
