const fs = require("fs");
const http = require("http");
const { execFileSync } = require("child_process");

const baseUrl = process.env.PREFLIGHT_BASE_URL || "http://localhost:3000";

async function main() {
  checkFiles();
  checkPackageScripts();
  checkSpecMarkers();
  runCommand("npm", ["test"]);
  runSyntaxChecks();
  await checkServer();
  checkPerformanceReport();
  console.log("preflight passed");
}

function checkFiles() {
  const required = [
    "README.md",
    ".github/workflows/ci.yml",
    "Dockerfile",
    "docker-compose.yml",
    "render.yaml",
    ".env.example",
    "db/schema.sql",
    "docs/demo-script.md",
    "docs/deployment.md",
    "docs/evaluating-ai-as-group-chat-participant.md",
    "docs/final-deliverable.md",
    "docs/performance-report.md",
    "docs/public-deployment-checklist.md",
    "src/core.js",
    "src/server.js",
    "src/storage.js",
    "src/llmProvider.js",
    "src/prompts.js",
    "public/index.html",
    "public/app.js",
    "public/styles.css",
    "scripts/load-test.js",
    "scripts/demo-seed.js",
  ];

  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  }
}

function checkPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const script of [
    "start",
    "start:memory",
    "test",
    "migrate:postgres",
    "load-test:smoke",
    "load-test:target",
    "demo:seed",
    "preflight",
  ]) {
    if (!pkg.scripts[script]) throw new Error(`Missing package script: ${script}`);
  }
}

function checkSpecMarkers() {
  const html = fs.readFileSync("public/index.html", "utf8");
  const app = fs.readFileSync("public/app.js", "utf8");
  const server = fs.readFileSync("src/server.js", "utf8");
  const core = fs.readFileSync("src/core.js", "utf8");
  const storage = fs.readFileSync("src/storage.js", "utf8");
  const schema = fs.readFileSync("db/schema.sql", "utf8");
  const render = fs.readFileSync("render.yaml", "utf8");
  const provider = fs.readFileSync("src/llmProvider.js", "utf8");
  const env = fs.readFileSync(".env.example", "utf8");

  for (const [file, body, markers] of [
    ["public/index.html", html, ["debugToggleButton", "displayNameInput", "normalChatBar", "participants", "policies", "routingDecisions"]],
    ["public/app.js", app, ["AI Shape", "basePersonality", "candidateScores", "comparisonColumn", "copyInviteLink", "renderExampleContext", "renderFailureModeCard", "renderNormalChatBar", "renderParticipants", "renderPolicies", "renderRuleAdjustments", "renderRoutingDecisions", "renderShapeStats", "renderThinkingState", "socialrl_debug_panel", "socialrl_display_name"]],
    ["src/server.js", server, ["addMessageAliases", "agent_stayed_silent", "eventValue", "message_stream_delta", "report_url", "resolveEventRoom", "sender_name"]],
    ["src/core.js", core, ["activePolicyOverrides", "applyRoutingPolicy", "generateImprovedPolicy", "pickRoutedWinner", "routingScores", "p99FullResponseLatencyMs", "routeNextAgentCounts"]],
    ["src/storage.js", storage, ["firstTokenLatencyMs", "first_token_latency_ms", "insertRoutingDecisions", "insertReportJobs", "routing_decisions", "report_jobs"]],
    ["db/schema.sql", schema, ["create table if not exists routing_decisions", "create table if not exists report_jobs", "first_token_latency_ms"]],
    ["render.yaml", render, ["healthCheckPath: /api/health", "fromDatabase:", "socialrl-arena-db"]],
    ["src/llmProvider.js", provider, ["OPENAI_DECISION_MODEL", "modelFor", "routerModelName"]],
    [".env.example", env, ["OPENAI_DECISION_MODEL", "OPENAI_ROUTER_MODEL", "OPENAI_MESSAGE_MODEL", "OPENAI_REPORT_MODEL"]],
  ]) {
    for (const marker of markers) {
      if (!body.includes(marker)) throw new Error(`${file} missing spec marker: ${marker}`);
    }
  }
}

function runSyntaxChecks() {
  const files = [
    "src/core.js",
    "src/server.js",
    "src/storage.js",
    "src/llmProvider.js",
    "src/prompts.js",
    "public/app.js",
    "scripts/load-test.js",
    "scripts/demo-seed.js",
    "scripts/migrate-postgres.js",
  ];

  for (const file of files) {
    runCommand("node", ["--check", file]);
  }
}

async function checkServer() {
  const health = await fetchJson("/api/health");
  if (!health.ok) throw new Error("Health endpoint is not ok.");

  const ready = await fetchJson("/api/ready");
  if (!ready.ok) throw new Error("Ready endpoint is not ok.");

  const rooms = await fetchJson("/api/rooms");
  if (!Array.isArray(rooms.rooms)) throw new Error("Room index did not return rooms array.");
}

function checkPerformanceReport() {
  const report = fs.readFileSync("docs/performance-report.md", "utf8");
  for (const needle of [
    "100 rooms",
    '"aiAgentsSimulated": 300',
    "1,000 messages",
    '"errors": 0',
    '"reportsReady": 100',
    '"unexpectedSocketCloses": 0',
    '"firstTokenSamples":',
    '"feedbackSamples": 100',
    '"p95FirstTokenLatencyMs"',
    '"p95FeedbackAckMs"',
    '"reportThroughputPerSecond"',
  ]) {
    if (!report.includes(needle)) throw new Error(`Performance report missing: ${needle}`);
  }
}

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            return;
          }
          resolve(JSON.parse(body));
        });
      })
      .on("error", reject);
  });
}

function runCommand(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
