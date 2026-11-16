#!/usr/bin/env bun
import { render } from "ink";
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";

import { SessionStore } from "core/session/SessionStore";
import App from "./app.js";

const { values } = parseArgs({ // before starting the tui. see if any args are passed in the cli
	options: {
		session: { type: "string" },
		continue: { type: "boolean" },
		sessions: { type: "boolean" },
	},
});

function main() {
	const cwd = realpathSync(process.cwd());

	if (values.sessions) {
		const files = SessionStore.list(cwd);

		console.log(
			files.length > 0
				? files.join("\n")
				: "No sessions for this directory.",
		);

		return;
	}

	let filepath = values.session;

	if (!filepath && values.continue) { // if not filepath given and user ran with only `rio --continue`
		filepath = SessionStore.list(cwd)[0]; // then from the list get the latest/newest session (by date)
	}


	// then load the session
	const session = filepath
		? SessionStore.load(filepath)
		: SessionStore.create( // means first time running cli from this path
			cwd,
			"openrouter",
			"qwen/qwen3.8-27b",
		);

	if (session.header.cwd !== cwd) {
		throw new Error(
			`Run Rio from the session directory: ${session.header.cwd}`,
		);
	}

	session.repairInterruptedTools();

	render(
		<App initialSession={session} />,
		{ maxFps: 60, exitOnCtrlC: false },
	);
}

try {
	main();
} catch (error) {
	console.error(
		error instanceof Error ? error.message : String(error),
	);
	process.exitCode = 1;
}
