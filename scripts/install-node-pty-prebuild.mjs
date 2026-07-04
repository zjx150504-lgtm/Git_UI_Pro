import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const packageDir = join(
  process.cwd(),
  "node_modules",
  "@homebridge",
  "node-pty-prebuilt-multiarch",
);

const releaseDir = join(packageDir, "build", "Release");
const conptyBinary = join(releaseDir, "conpty.node");

if (process.platform !== "win32") {
  process.exit(0);
}

if (existsSync(conptyBinary)) {
  process.exit(0);
}

if (!existsSync(packageDir)) {
  console.warn("[postinstall] node-pty package is not installed; skipping prebuild install.");
  process.exit(0);
}

const archiveUrl =
  "https://github.com/oznu/node-pty-prebuilt-multiarch/releases/download/v0.13.1/node-pty-prebuilt-multiarch-v0.13.1-electron-v121-win32-x64.tar.gz";
const archivePath = join(tmpdir(), "node-pty-prebuilt-multiarch-electron-v121-win32-x64.tar.gz");

mkdirSync(dirname(archivePath), { recursive: true });
mkdirSync(releaseDir, { recursive: true });

console.log("[postinstall] downloading Electron PTY prebuild...");

await downloadWithRetry(archiveUrl, archivePath, 3);

console.log("[postinstall] extracting Electron PTY prebuild...");

execFileSync("tar", ["-xzf", archivePath, "-C", packageDir], { stdio: "inherit" });

if (!existsSync(conptyBinary)) {
  throw new Error("node-pty prebuild extraction finished, but conpty.node was not found.");
}

await rm(archivePath, { force: true });

console.log("[postinstall] Electron PTY prebuild installed.");

async function downloadWithRetry(url, targetPath, attempts) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await download(url, targetPath);
      return;
    } catch (error) {
      lastError = error;
      await rm(targetPath, { force: true });
      if (attempt < attempts) {
        console.warn(`[postinstall] download failed, retrying (${attempt}/${attempts})...`);
      }
    }
  }

  throw lastError;
}

function download(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        download(response.headers.location, targetPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(targetPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.setTimeout(120_000, () => {
      request.destroy(new Error("Download timed out."));
    });
    request.on("error", reject);
  });
}
