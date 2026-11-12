import { MODEL_OPTIONS } from "./models.js";
import { Command, CommandContext } from "./types.js";

export function allcommands(ctx: CommandContext): Command[] { // so we get all the commands in ui with this function
	// and while getting pass all the context and function required by those commands to run.
	return [
		{
			name: "/model",
			description: "Select model provider",
			action: {
				kind: "submenu",
				options: MODEL_OPTIONS,
				onSelect: (v: any) => {
					// do something with the value selected
					// also set the current model in the ui to this
					ctx.selectModel(v)
				},
			}
		},
		{
			name: "/login",
			description: "Configure provider",
			action: {
				kind: "run",
				run: () => ctx.openLogin() // this will run the command
			}
		},
		{
			name: "/quit",
			description: "Exit the session",
			action: {
				kind: "run",
				run: () => ctx.exit()
			}
		},
		{
			name: "/session",
			description: "Current session info",
		},
		{
			name: "/new",
			description: "Start a new session", // start a new session with random id. save it to particular date and time folder nested
			action: {
				kind: "run",
				run: () => ctx.newSession()
			}
		},
		{
			name: "/settings",
			description: "change settings",
		},

	]
}

