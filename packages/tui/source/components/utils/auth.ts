import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_DIR = join(homedir(), '.rio') // homedir gets the /home/cell path
const AUTH_PATH = join(CONFIG_DIR, 'auth.json') // home/cell/.rio/auth.json

export async function saveApiKey(apiKey: string) {
	const input = {
		openrouter: {
			type: "api_key",
			key: apiKey
		}
	}
	await mkdir(CONFIG_DIR, { recursive: true })
	await writeFile(AUTH_PATH, JSON.stringify(input))
}

export async function loadApiKey(): Promise<string | null> {
	try {
		const raw = await readFile(AUTH_PATH, 'utf-8')
		return JSON.parse(raw).openrouter.key
	} catch (e) {
		// error while getting apiKey
		return null
	}
}
