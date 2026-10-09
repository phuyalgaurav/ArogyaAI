import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const apiOnly = process.argv.includes("--api");
const backendOnly = process.argv.includes("--backend");
const production = process.argv.includes("--production");
const configured = existsSync(".local/backend.env");
if (backendOnly && !configured) {
  console.error("Run pnpm setup:ai to configure the local inference worker.");
  process.exit(1);
}
if (configured) loadEnvFile(".local/backend.env");
const hasAi = Boolean(process.env.AROGYA_WORKER_URL);
const hasLanguage = Boolean(process.env.AROGYA_LANGUAGE_WORKER_URL);
const uv = [
  "run",
  "--project",
  "services/api",
  ...(hasAi ? ["--extra", "classifier"] : []),
  ...(hasLanguage ? ["--extra", "language"] : []),
  ...(process.env.AROGYA_OCR_DIR ? ["--extra", "ocr"] : []),
];
const commands = [];
if (!apiOnly && !backendOnly) commands.push(["pnpm", ["dev:web"]]);
commands.push([
  "uv",
  [
    ...uv,
    "uvicorn",
    "arogya_api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    ...(production ? [] : ["--reload", "--reload-dir", "services/api/src"]),
    "--no-access-log",
  ],
]);
if (hasAi && !apiOnly) {
  Object.assign(process.env, {
    OLLAMA_HOST: new URL(process.env.AROGYA_OLLAMA_URL).host,
    OLLAMA_NO_CLOUD: "1",
    OLLAMA_NUM_PARALLEL: "1",
    OLLAMA_MAX_LOADED_MODELS: "1",
    OLLAMA_MAX_QUEUE: "8",
  });
  try {
    const response = await fetch(`${process.env.AROGYA_OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Ollama unavailable");
  } catch {
    commands.push(["ollama", ["serve"]]);
  }
  commands.push([
    "uv",
    [
      ...uv,
      "uvicorn",
      "arogya_api.inference.worker:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8001",
      "--no-access-log",
    ],
  ]);
}
if (hasLanguage && !apiOnly) {
  commands.push([
    "uv",
    [
      ...uv,
      "uvicorn",
      "arogya_api.speech.worker:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8002",
      "--no-access-log",
    ],
  ]);
}
const isWindows = process.platform === "win32";
const children = commands.map(([command, args]) =>
  spawn(command, args, {
    stdio: "inherit",
    detached: !isWindows,
    shell: isWindows,
  }),
);
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (isWindows) {
        spawn("taskkill", ["/pid", child.pid.toString(), "/t", "/f"]);
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
  process.exitCode = code;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
