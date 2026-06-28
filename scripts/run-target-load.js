const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const port = Number(process.env.TARGET_LOAD_PORT || 3100);
const outputPath =
  process.env.LOAD_TEST_OUTPUT_PATH || path.join("demo-artifacts", "target-load-latest.json");
const serverEnv = {
  ...process.env,
  PORT: String(port),
  SOCIALRL_STORAGE: "memory",
};
const loadEnv = {
  ...process.env,
  LOAD_TEST_URL: process.env.LOAD_TEST_URL || `ws://localhost:${port}`,
  LOAD_TEST_ROOMS: process.env.LOAD_TEST_ROOMS || "100",
  LOAD_TEST_USERS_PER_ROOM: process.env.LOAD_TEST_USERS_PER_ROOM || "3",
  LOAD_TEST_MESSAGES_PER_ROOM: process.env.LOAD_TEST_MESSAGES_PER_ROOM || "10",
  LOAD_TEST_OUTPUT_PATH: outputPath,
};

async function main() {
  const server = spawn(process.execPath, ["src/server.js"], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = [];
  server.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));

  try {
    await waitForReady(`http://localhost:${port}/api/ready`, 10000);
    const code = await runLoadTest(loadEnv);
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    console.error(error.message);
    const recentLog = serverLog.join("").trim();
    if (recentLog) console.error(recentLog);
    process.exitCode = 1;
  } finally {
    stopProcess(server);
  }
}

function runLoadTest(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/load-test.js"], {
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code === null ? 1 : code));
  });
}

async function waitForReady(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReady(url)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for memory server on ${url}`);
}

function isReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1000).unref();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
