import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";


export const MAX_ATTACHMENT_BYTES = 20 * 1024 // 20 kb
export const MAX_DIRECTORY_ENTRIES = 50;

export async function attachReferences(
	prompt: string,
	signal?: AbortSignal,
): Promise<string> {
	const attachments: string[] = [];

	// Match @references at the beginning or after whitespace.
	const references = prompt.matchAll(/(?:^|\s)@(\S+)/g); // extracts @mentions in starting of prompt string or after space with ignoring @
	const seen = new Set<string>();

	// for every  @src/ and @tests/
	// since one user input prompt can have many directories references not just single
	for (const match of references) {
		signal?.throwIfAborted();

		const reference = match[1]!;
		const filepath = resolve(process.cwd(), reference);

		if (seen.has(filepath)) continue;
		seen.add(filepath);

		const info = await stat(filepath);

		if (info.isFile()) { // if is file
			if (info.size > MAX_ATTACHMENT_BYTES) { // if large file
				attachments.push(
					`File reference: ${reference} (${info.size} bytes)\n` +
					"Contents omitted because the file exceeds 20 KB. " +
					"Use the read tool to inspect relevant portions.",
				);
			} else { // else just read the file
				const buffer = await readFile(filepath, { signal });

				// Recheck size in case the file changed after stat().
				if (buffer.length > MAX_ATTACHMENT_BYTES || buffer.includes(0)) {
					attachments.push(
						`File reference: ${reference}\n` +
						"Contents omitted: large file or suspected binary file.",
					);
				} else {
					attachments.push(
						`File contents: ${reference}\n` +
						`<file_contents>\n${buffer.toString("utf8")}\n</file_contents>`,
					);
				}
			}
			continue; // continue
		}

		if (!info.isDirectory()) {
			throw new Error(`Unsupported reference: ${reference}`);
		}

		const entries = await readdir(filepath, { // read the directory
			withFileTypes: true,
		});

		entries.sort((a, b) => a.name.localeCompare(b.name));

		const listing = entries
			.slice(0, MAX_DIRECTORY_ENTRIES)
			.map(entry =>
				entry.isDirectory() ? `${entry.name}/` : entry.name,
			)
			.join("\n");

		const notice = // optional notice
			entries.length > MAX_DIRECTORY_ENTRIES
				? `\n[Showing ${MAX_DIRECTORY_ENTRIES} of ${entries.length} entries]`
				: "";

		attachments.push(
			`Directory listing: ${reference}\n` +
			`${listing || "(empty directory)"}${notice}`,
		);
	}

	signal?.throwIfAborted();

	if (attachments.length === 0) return prompt;

	return `${prompt}\n\nAttached references:\n\n${attachments.join("\n\n")}`;
}
