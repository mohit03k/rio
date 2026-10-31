interface TruncateHeadResult {
  content: string,
  truncated: boolean,
  truncatedBy: "bytes" | "lines" | null
  outputBytes: number
}

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
// after building add output accumulator. Bounded memory and tail truncation. process lifecycle to end after timeout

// THIS is tail truncation good for bashTool outputs but not for grep. truncateHead should be used there
/** 
  * keep the END of the output(errors and results are usually at the bottom).
  * keep the last 2k lines then keep the last 51800 bytes of those 2k lines (as lines may have emoji and character which takes more bytes)
*/
export function truncateOutput(output: string): string {
  if (!output) return output;

  const lines = output.split("\n");
  let out = lines.slice(-DEFAULT_MAX_LINES).join("\n"); // grabs the last 2k lines (max or low) and joins them
  let partialLine = false;

  const bytes = Buffer.from(out, "utf8");

  if (bytes.length > DEFAULT_MAX_BYTES) { // if more than max bytest. remove those bytes
    // start is byte position where retained output should begin
    // start = 60,000 - 51,200 = 8,800
    // [ first 8,800 bytes ][ last 51,200 bytes ]
    //        discard              keep
    let start = bytes.length - DEFAULT_MAX_BYTES;

    // Skip UTF-8 continuation bytes to avoid splitting a character.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
      start++;
    }

    partialLine = bytes[start - 1] !== 0x0a;
    out = bytes.subarray(start).toString("utf8");
  }

  if (out === output) return output;

  const kept = out.split("\n");
  const note = partialLine ? "; first shown line is partial" : "";

  return `[truncated: showing the last ${kept.length} of ${lines.length} lines${note}]\n${out}`;
}

export function truncateHead(content: string): TruncateHeadResult {

  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.length === 0 ? [] : content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  const totalLines = lines.length

  // Check if no truncation needed
  if (totalLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      outputBytes: totalBytes
    };
  }

  // Collect complete lines that fit
  const outputLinesArray: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < lines.length && i < DEFAULT_MAX_LINES; i++) { // for each line
    const lineBytes = Buffer.byteLength(lines[i]!, "utf-8") + (i > 0 ? 1 : 0); // each line bytes

    if (outputBytesCount + lineBytes > DEFAULT_MAX_BYTES) {
      truncatedBy = "bytes";
      break; // DEFAULT_MAX_BYTES limit is reached output till these lines
    }
    // else push line to  array
    outputLinesArray.push(lines[i]!)
    outputBytesCount += lineBytes;
  }

  // If we exited due to line limit
  if (outputLinesArray.length >= DEFAULT_MAX_LINES && outputBytesCount <= DEFAULT_MAX_BYTES) {
    truncatedBy = "lines";
  }
  const outputContent = outputLinesArray.join("\n"); // join the lines to raw text by \n
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

  return {
    content: outputContent,
    truncated: true,
    truncatedBy: truncatedBy,
    outputBytes: finalOutputBytes
  }
}
