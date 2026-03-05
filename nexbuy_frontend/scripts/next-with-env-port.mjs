import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const command = process.argv[2] ?? "dev";
const supportedCommands = new Set(["dev", "start"]);

if (!supportedCommands.has(command)) {
  console.error(`Unsupported Next.js command: ${command}`);
  process.exit(1);
}

const cwd = process.cwd();
const port = readConfiguredPort(cwd) ?? "3000";
const nextBinPath = path.join(cwd, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBinPath, command, "-p", port], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function readConfiguredPort(rootDir) {
  const envFilePaths = [".env.local", ".env"].map((fileName) =>
    path.join(rootDir, fileName),
  );

  for (const envFilePath of envFilePaths) {
    if (!existsSync(envFilePath)) {
      continue;
    }

    const fileContent = readFileSync(envFilePath, "utf8");
    const parsedPort = parsePortFromEnv(fileContent);

    if (parsedPort) {
      return parsedPort;
    }
  }

  return process.env.PORT;
}

function parsePortFromEnv(fileContent) {
  const lines = fileContent.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();

    if (key !== "PORT") {
      continue;
    }

    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    return rawValue.replace(/^['"]|['"]$/g, "");
  }

  return null;
}
