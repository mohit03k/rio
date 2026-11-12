import path from "node:path"
import os from "node:os"
import fs from "fs"

export class SessionStore { // every time a rio is on. A new SessionStore is created with that cwd and model. storing session details temp
  // in memory until any first messages is initiated for user
  private session: any;
  public hasWrittenFile = false

  constructor(cwd: string, model: string) { // process.cwd
    this.session = {
      cwd: cwd,
      model: model,
      createdAt: new Date().toISOString(), // to get the year day format
      sessionId: crypto.randomUUID(),
      messages: []
    }
  }

  appendMessage(message: any) {
    this.session.messages.push(message)
    this.writeToFile(message)
  }

  private writeSessionHeader(filepath: string) {
    const message = {
      type: "session",
      id: this.session.sessionId,
      cwd: this.session.cwd,
      timestamp: this.session.createdAt,
    }
    fs.mkdirSync(filepath, { recursive: true })
    fs.writeFileSync(filepath, JSON.stringify(message) + '\n');
  }

  private writeToFile(message: any) {
    const filepath = this.getFilePath()
    // if this is the first time first make that path
    if (!this.hasWrittenFile) { // if this is the first message create the file and write to file
      // first write session header
      this.writeSessionHeader(filepath)
      this.hasWrittenFile = true
    }
    const entry = {
      type: "message",
      id: Math.random().toString(36).slice(2, 12),
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text: message }]
      }
    }
    // then write the message
    fs.appendFileSync(filepath, JSON.stringify(entry) + '\n');
  }

  private getFilePath() {
    const date = new Date(this.session.createdAt)
    const year = date.getFullYear().toString()
    const month = String(date.getMonth() + 1).padStart(2, '0') // makes hte month from 5 to 05
    const day = date.getDay().toString()

    return path.join(os.homedir(), ".rio", "sessions", year, month, day, `${this.session.sessionId}.jsonl`)
  }



}
