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
    "scripts/final-audit.js",
    "scripts/final-handoff.js",
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
    "final-audit",
    "final-audit:local",
    "final-handoff",
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
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const provider = fs.readFileSync("src/llmProvider.js", "utf8");
  const env = fs.readFileSync(".env.example", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  const loadTest = fs.readFileSync("scripts/load-test.js", "utf8");
  const targetLoad = fs.readFileSync("scripts/run-target-load.js", "utf8");
  const finalAudit = fs.readFileSync("scripts/final-audit.js", "utf8");
  const finalHandoff = fs.readFileSync("scripts/final-handoff.js", "utf8");
  const pkg = fs.readFileSync("package.json", "utf8");

  for (const [file, body, markers] of [
    ["public/index.html", html, ["debugToggleButton", "displayNameInput", "normalChatBar", "normalSessionFeedback", "replyPreview", "participants", "policies", "routingDecisions"]],
    ["public/app.js", app, ["AI Shape", "agentSelectionRules", "basePersonality", "candidateScores", "comparisonColumn", "copyInviteLink", "humanMomentumDirection", "landing", "live-telemetry-card", "model-step-tags", "normalAgentOptions", "reply_to_message_id", "renderDecisionReview", "renderEvidenceManifest", "renderExampleContext", "renderFailureModeCard", "renderLandingPage", "renderLiveTelemetry", "renderModelStepTags", "renderModelRoutingSummary", "renderNormalChatBar", "renderNormalSessionFeedback", "renderParticipants", "renderPolicies", "renderReplyContext", "renderReplyPreview", "renderRoutingDecisions", "renderRoutingFeedbackVotes", "renderRuleAdjustments", "renderRunArchive", "renderShapeStats", "renderSystemPerformance", "renderThinkingState", "targetUser", "socialrl_debug_panel", "socialrl_display_name"]],
    ["src/server.js", server, ["addMessageAliases", "agent_stayed_silent", "agent_waited", "eventValue", "message_stream_delta", "reply_to_message_id", "report_url", "resolveEventRoom", "sender_name", "session_feedback_refresh"]],
    ["src/core.js", core, ["activePolicyOverrides", "advice_spiral", "agentSelectionRules", "applyRoutingPolicy", "archiveCurrentRun", "buildDecisionReview", "buildEvidenceManifest", "buildModelRoutingPlan", "buildModelRoutingSummary", "buildRoutingRecommendationReason", "casual_hangout", "chaotic", "debate_prep", "decisionReview", "detectQuietParticipant", "emotionallySensitive", "evidenceManifest", "exportRunSnapshot", "first_token_latency_ms", "fandom_rp", "game_night", "generateImprovedPolicy", "humanConversationDelta", "humanConversationLift", "humanMomentumDirection", "latency_ms", "Message feedback can only be added to AI messages", "modelRoutingSummary", "normalizeReplyToMessageId", "pickRoutedWinner", "pizza-themed side quest", "refreshLatestReport", "replyTargetRate", "replyToMessageId", "routingScores", "runHistory", "senderId", "roomsTracked", "stalled", "support_checkin", "targetedDecisionRate", "targetUserForDecision", "targetUserCounts", "token_count", "p99FirstTokenLatencyMs", "p99FullResponseLatencyMs", "llmErrorRate", "routeNextAgentCounts"]],
    ["src/storage.js", storage, ["decision_review", "evidence_manifest", "model_routing", "model_routing_summary", "firstTokenLatencyMs", "first_token_latency_ms", "insertRoutingDecisions", "insertReportJobs", "routing_decisions", "report_jobs"]],
    ["db/schema.sql", schema, ["create table if not exists routing_decisions", "create table if not exists report_jobs", "decision_review", "evidence_manifest", "model_routing", "model_routing_summary", "first_token_latency_ms"]],
    ["Dockerfile", dockerfile, ["node:22-alpine"]],
    ["render.yaml", render, ["healthCheckPath: /api/health", "fromDatabase:", "socialrl-arena-db"]],
    [".github/workflows/ci.yml", ci, ["npm run demo:seed", "npm run load-test:target-artifact", "npm run final-audit:local"]],
    ["src/llmProvider.js", provider, ["OPENAI_DECISION_MODEL", "modelFor", "recordProviderFailure", "routerModelName"]],
    ["src/prompts.js", fs.readFileSync("src/prompts.js", "utf8"), ["buildReportEvalInputs", "fullTranscript", "messageLatency", "evidenceManifest", "emotionally_sensitive", "stalled", "chaotic"]],
    [".env.example", env, ["OPENAI_DECISION_MODEL", "OPENAI_ROUTER_MODEL", "OPENAI_MESSAGE_MODEL", "OPENAI_REPORT_MODEL"]],
    ["README.md", readme, ["flowchart LR", "Report queue + worker", "Per-stage model routing evidence", "Transcript/report JSON export", "Synthetic WebSocket load test", "Normalized messages, decisions, routing, feedback, reports", "Final Submission Status", "LIVE_DEMO_URL", "GITHUB_REPO_URL", "LOOM_URL"]],
    ["scripts/load-test.js", loadTest, ["lastAiMessageId", "LOAD_TEST_OUTPUT_PATH", "passed"]],
    ["scripts/run-target-load.js", targetLoad, ["SOCIALRL_STORAGE", "target-load-latest.json", "LOAD_TEST_MESSAGES_PER_ROOM"]],
    ["scripts/final-audit.js", finalAudit, ["FINAL_AUDIT_LOCAL_ONLY", "mode: localOnly", "aiOnlyFeedbackCheck", "demoScenarioFidelityCheck", "reportJudgePromptCheck", "targetLoadArtifactChecks", "perf:target-load-artifact"]],
    ["scripts/final-handoff.js", finalHandoff, ["SocialRL Arena Final Handoff", "Target Load Evidence", "Local Audit", "Final Audit", "Reviewer Path"]],
    ["package.json", pkg, ["load-test:target-artifact", "final-audit:local", "final-handoff"]],
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
    "scripts/final-audit.js",
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

  for (const path of ["/", "/create", "/rooms/demo-room"]) {
    const page = await fetchText(path);
    if (!page.includes("SocialRL Arena") || !page.includes("/app.js")) {
      throw new Error(`Page route did not return the SPA shell: ${path}`);
    }
  }
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
    '"p99FirstTokenLatencyMs"',
    '"p95MessageFanoutMs"',
    '"p99MessageFanoutMs"',
    '"p95FeedbackAckMs"',
    '"p99FeedbackAckMs"',
    '"p99ReportLatencyMs"',
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

function fetchText(path) {
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
          resolve(body);
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
