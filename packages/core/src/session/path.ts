import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os"
import path, { join } from "node:path"
// function to get session path to load in the tui. if user decides to resume a session


export function getSessionDirectory(cwd: string): string {
  // turns messy path home/user/project/src/../ to /home/user/project/pacakge.json
  const directory = realpathSync(cwd);

  const hash = createHash("sha256")
    .update(directory) // will generate the same hash everytime on same directory
    .digest("hex");

  return join(homedir(), ".rio", "sessions", hash); // /home/cell/.rio/sessions/ada09dsg0a09f8asalksdg0asdgii
}
