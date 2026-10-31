import { spawnSync } from "child_process"
import { mkdirSync, createWriteStream } from "fs"
import { arch, homedir, platform } from "os"
import { join } from "path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs"

const APP_NAME = ".rio"

interface ToolsConfig {
  name: string
  repo: string
  binaryName: string
  tagPrefix: string
  systemBinaryNames?: string[]
  getAssetName: (version: string, target: string) => string
}

// config to help find the path of tool . or install if from repo
const TOOLS: Record<string, ToolsConfig> = {
  rg: {
    name: "rg",
    repo: "BurntSushi/ripgrep",
    tagPrefix: "",
    binaryName: "rg",
    getAssetName: (version, target) => `ripgrep-${version}-${target}`
  }
}
/**
 * Ensure a tool is available, downloading if necessary.
 * Returns the tool path, or undefined if unavailable.
 */
export async function ensureTool(tool: "rg") {
  const pathExists = getFilePath(tool);
  if (pathExists) { // means tool already exists
    return pathExists;
  }

  // else try downloading the tool
  const config = TOOLS[tool];
  if (!config) return undefined;

  if (platform() === "android") {

    return undefined
  }

  try {
    const path = await downloadTool(tool);
    return path;
  } catch (e) {
    // if some error occured on download tool return undefined
    return undefined;
  }

}



async function getLatestVersion(repo: string) {
  try {
    // redirect manual instead of redirect. returns 300-399 status which includes exact tag /tag/15.2.0
    const res = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: "manual" })

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) {
      throw new Error(`Failed to resolve latest ${repo} release`)
    }
    const tag = new URL(location, "https://github.com").pathname.split("/").pop(); // pops the last element from the array which is tag v15.5.0

    if (!tag || !location.includes('/releases/tag')) {
      throw new Error(`Failed to resolve latest tag . unknown redirect to ${location}`)
    }
    return decodeURIComponent(tag).replace(/^v/, ""); // if somehow tag is v15.5.0 then "15.5.0" is returned
  } catch (e) {
    throw new Error(`Error while geting latest release ${repo}`)
  }

}


// if path doesnt exist, means we download and install the tool
async function downloadTool(tool: "rg") {
  const config = TOOLS[tool];
  if (!config) throw new Error(`Unkown tool ${tool}`)

  // get the target to download based on platform and architecture
  const plat = platform();
  const architecture = arch(); // example x64. arm64 etc
  const archStr = architecture === "arm64" ? "aarch64" : architecture === "x64" ? "x86_64" : undefined;
  if (!archStr) {
    throw new Error(`Unsupported platform ${plat} ${architecture}`)
  }
  let target: string;
  if (plat === "darwin") {
    target = `${archStr}-apple-darwin.tar.gz`; // for mac
  } else if (plat === "linux") {
    target = `${archStr}-unknown-linux-musl.tar.gz`; // for linux 
  } else if (plat === "win32") {
    target = `${archStr}-pc-windows-msvc.zip`; // windows
  } else {
    throw new Error(`Unsupported platform: ${plat} (${archStr})`);
  }

  const version = await getLatestVersion(config.repo);
  //             {version} - {target}
  // so ripgrep-15.2.0-unknown-linux-musl.tar.gz
  const assetName = config.getAssetName(version, target);

  const res = join(homedir(), APP_NAME, "agent")

  // home/user/.rio/agent/bin
  const path = join(res, "bin");

  // create tools dir
  // in .rio/agent/bin
  mkdirSync(path, { recursive: true })

  // tagPrefix for this repo is nothing. other are ("v", "app_v")
  // eg-  https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz
  const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`

  // .rio/agent/bin/ripgrep-15.2.0...
  // archive path
  const pathForTool = join(path, assetName);
  const binaryExtension = plat === "win32" ? ".exe" : "";

  // binary path. where the downloaded file will extract the bin
  const binaryPath = join(path, config.binaryName + binaryExtension);

  await downloadFile(downloadUrl, pathForTool);

  // might produce something like 
  // /home/user/.rio/agent/bin/extract_tmp_rg_12345_1793234567890_k8x2m4pz
  const extractDir = join(
    path,
    `extract_tmp_${config.binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );
  mkdirSync(extractDir, { recursive: true });

  // finnaly extract the file

  try {
    if (assetName.endsWith(".tar.gz")) { // linux , darwin
      const failure = runExtractionCommand("tar", ["xzf", pathForTool, "-C", extractDir]);
      if (failure) { // some error
        throw new Error(`Failed to extract ${assetName}: ${res}`);
      }
    } else if (assetName.endsWith(".zip")) { // windows
      extractZip(pathForTool, extractDir);
    } else {
      throw new Error(`Unsupported acrhive format: ${assetName}`)
    }

    // now find binary in extracted files
    const binaryFilename = config.binaryName + binaryExtension;  // "rg" for linux
    const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/, ""));
    const extractedBinaryCandidates = [join(extractedDir, binaryFilename), join(extractDir, binaryFilename)];

    // /home/.../extract_tmp_rg_1234_.../ripgrep-14.1.0-x86_64-unknown-linux-musl/rg
    let extractedBinary = extractedBinaryCandidates.find((candidate) => existsSync(candidate));

    if (!extractedBinary) {
      extractedBinary = findBinaryRecursively(extractDir, binaryFilename) ?? undefined; // set extractedBinary
    }

    // "We downloaded a tar/zip release"
    // "We extracted it to a temp folder"
    // "We looked for the actual executable inside it"
    // "If not found anywhere, we abort installation"

    // finally. rename extractedBinary -> binaryPath (home/user/.rio/agent/bin/rg)
    if (extractedBinary) {
      renameSync(extractedBinary, binaryPath);
    } else {
      throw new Error(`Binary not found in archive: expected ${binaryFilename} under ${extractDir}`);
    }
  } finally { // this code block will run full. even though an error was throw in try.
    // if some error was throw. recursively rmemove or delete the directories created
    // cleanup
    rmSync(pathForTool, { force: true })// deletes the folder where tool was downloaded
    rmSync(extractDir, { recursive: true, force: true }) // if somehow extracted and failure occured. delete it
  }

  return binaryPath;
}
function findBinaryRecursively(extractDir: string, binaryFileName: string): string | null {
  const stack: string[] = [extractDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = readdirSync(currentDir, { withFileTypes: true }); // gives all files in this dir
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) { // if the entry is file. and matches the binaryFilename. return full path
        return fullPath;
      }
      // else push it to stack so on next iteration we check on this dir
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}
function runExtractionCommand(command: string, args: string[]) {
  const res = spawnSync(command, args, { stdio: "pipe" }); // res contains result of exected process

  if (!res.error && res.status === 0) {
    return null; // no error
  }

  return `${command}: failed to run ${res}`
}

function getWindowsTarCommand() {
  // this command is used in nodejs to retreive windows os installation directory
  // usually C:\Windows
  const systemRoot = process.env.SystemRoot;

  if (systemRoot) {
    const systemTar = join(systemRoot, "System32", "tar.exe");

    if (existsSync(systemTar)) {
      return systemTar
    }
  }
  // since in new windws os. tar.exe is normally present in both system32 or globally in cmd
  return "tar.exe"
}

function extractZip(pathForTool: string, extractDir: string) {
  if (platform() === "win32") {
    const failure = runExtractionCommand(getWindowsTarCommand(), ["xf", pathForTool, "-C", extractDir])
    if (!failure) return;

    const script =
      "& { param($archive, $destination) $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";

    const powershellFailure = runExtractionCommand("powershell.exe", ["-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command", script, pathForTool, extractDir]);
    if (!powershellFailure) return;

  } else { // if platform is other than win32 or linux or darwin
    const unzipFailure = runExtractionCommand("unzip", ["-q", pathForTool, "-d", extractDir]);
    if (!unzipFailure) return

    const tarFailure = runExtractionCommand("tar", ["xf", pathForTool, "-C", extractDir])
    if (!tarFailure) return
  }
  throw new Error(`Failed to extract ${pathForTool}. inside extractZip()`)
}


// downloads a file from url, and put it in destination
async function downloadFile(downloadUrl: string, destination: string) {

  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const writeStream = createWriteStream(destination) // writes data to file in chunks

  // pipeline . used for completing streams in segements. rather than loading entire data into ram as file could be big.
  // a pipeline connects a readable stream (source), a Optional transform stream and a writeableStream the final destination
  await pipeline(
    Readable.fromWeb(response.body as any),
    writeStream
  )
}

/**
  * given the tool. run the command by spawing child_process to know if it exists. return path if does
*/
function getFilePath(tool: "rg"): string | null {
  const config = TOOLS[tool];

  if (!config) return null

  const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];

  for (const name of systemBinaryNames) {
    try {
      const res = spawnSync(name, ["--version"], { stdio: "pipe" });
      if (res.error !== undefined || res.error !== null) {
        return name
      }
    } catch {
    }
  }
  return null
}
