const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const requiredFiles = [
  "README.md",
  "docs/demo-script.md",
  "docs/deployment.md",
  "docs/evaluating-ai-as-group-chat-participant.md",
  "docs/final-deliverable.md",
  "docs/performance-report.md",
  "docs/public-deployment-checklist.md",
  "render.yaml",
  ".github/workflows/ci.yml",
];

const requiredEnvLinks = [
  ["LIVE_DEMO_URL", "live demo"],
  ["GITHUB_REPO_URL", "GitHub repo"],
  ["LOOM_URL", "90-second Loom"],
];

function main() {
  const localOnly = process.env.FINAL_AUDIT_LOCAL_ONLY === "1" || process.argv.includes("--local");
  const checks = [
    ...requiredFiles.map((file) => fileCheck(file)),
    ...(localOnly ? [] : [gitRemoteCheck()]),
    debugTelemetryCheck(),
    aiOnlyFeedbackCheck(),
    reportJudgePromptCheck(),
    ...latestDemoArtifactChecks(),
    ...targetLoadArtifactChecks(),
    ...(localOnly ? [] : requiredEnvLinks.map(([name, label]) => envUrlCheck(name, label))),
  ];
  const failed = checks.filter((check) => check.status !== "pass");

  console.log(JSON.stringify({ ok: failed.length === 0, mode: localOnly ? "local" : "final", checks }, null, 2));
  if (failed.length) process.exit(1);
}

function fileCheck(file) {
  return {
    name: `file:${file}`,
    status: fs.existsSync(file) ? "pass" : "fail",
    detail: fs.existsSync(file) ? "present" : "missing",
  };
}

function gitRemoteCheck() {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { name: "git:origin", status: remote ? "pass" : "fail", detail: remote || "missing" };
  } catch (error) {
    return { name: "git:origin", status: "fail", detail: "missing origin remote" };
  }
}

function debugTelemetryCheck() {
  const appPath = path.join(process.cwd(), "public", "app.js");
  const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";
  const requiredMarkers = [
    "renderLiveTelemetry",
    "live-telemetry-card",
    "Avg first token",
    "Report queue",
    "model-step-tags",
    "Active policy",
  ];
  const missing = requiredMarkers.filter((marker) => !app.includes(marker));
  return {
    name: "ui:debug-telemetry",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? `debug/eval UI missing ${missing.join(", ")}`
      : "debug/eval UI includes live latency, report queue, policy, feedback, and model-step telemetry",
  };
}

function reportJudgePromptCheck() {
  const promptPath = path.join(process.cwd(), "src", "prompts.js");
  const prompts = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf8") : "";
  const requiredMarkers = [
    "buildReportEvalInputs",
    "fullTranscript",
    "agentDecisions",
    "messageLatency",
    "agentConfigs",
    "evidenceManifest",
    "decisionReview",
    "routingScores",
  ];
  const missing = requiredMarkers.filter((marker) => !prompts.includes(marker));
  return {
    name: "prompt:report-eval-inputs",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? `report judge prompt missing ${missing.join(", ")}`
      : "report judge prompt includes transcript, decisions, feedback, latency, agent config, evidence, decision review, and routing scores",
  };
}

function aiOnlyFeedbackCheck() {
  const corePath = path.join(process.cwd(), "src", "core.js");
  const loadPath = path.join(process.cwd(), "scripts", "load-test.js");
  const core = fs.existsSync(corePath) ? fs.readFileSync(corePath, "utf8") : "";
  const loadTest = fs.existsSync(loadPath) ? fs.readFileSync(loadPath, "utf8") : "";
  const ok =
    core.includes("Message feedback can only be added to AI messages") &&
    loadTest.includes("lastAiMessageId") &&
    !loadTest.includes("lastSentHumanMessageId");
  return {
    name: "feedback:ai-only",
    status: ok ? "pass" : "fail",
    detail: ok
      ? "runtime and load test attach message feedback only to AI messages"
      : "message feedback must reject human messages and load test must tag an AI message",
  };
}

function latestDemoArtifactChecks() {
  const dir = path.join(process.cwd(), "demo-artifacts");
  if (!fs.existsSync(dir)) {
    return [{ name: "demo:latest-artifacts", status: "fail", detail: "demo-artifacts missing" }];
  }

  const links = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith("-links.md"))
    .map((file) => ({ file, stat: fs.statSync(path.join(dir, file)) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (!links.length) {
    return [{ name: "demo:latest-artifacts", status: "fail", detail: "run npm run demo:seed" }];
  }

  const latestLinks = links[0].file;
  const roomId = latestLinks.replace(/-links\.md$/, "");
  const exportPath = path.join(dir, `${roomId}-export.json`);
  const checks = [
    {
      name: "demo:latest-artifacts",
      status: fs.existsSync(exportPath) ? "pass" : "fail",
      detail: fs.existsSync(exportPath) ? `${latestLinks} + export JSON` : `${latestLinks} has no export JSON`,
    },
  ];

  if (!fs.existsSync(exportPath)) return checks;

  let exported;
  try {
    exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  } catch (error) {
    return [
      ...checks,
      { name: "demo:export-json", status: "fail", detail: `invalid JSON: ${error.message}` },
    ];
  }

  return [
    ...checks,
    freshArtifactCheck(exportPath, links[0].stat),
    demoContentCheck(exported),
    demoScenarioFidelityCheck(exported),
    demoReportCheck(exported),
    demoExportCheck(exported),
  ];
}

function freshArtifactCheck(exportPath, linksStat) {
  const commitMs = latestCommitMsFor([
    "src",
    "public",
    "scripts/demo-seed.js",
  ]);
  const exportMs = fs.statSync(exportPath).mtimeMs;
  const linksMs = linksStat.mtimeMs;
  const fresh = exportMs >= commitMs && linksMs >= commitMs;
  return {
    name: "demo:fresh-after-head",
    status: fresh ? "pass" : "fail",
    detail: fresh ? "latest demo was generated after the latest demo/runtime commit" : "rerun npm run demo:seed",
  };
}

function demoContentCheck(exported) {
  const room = exported.room || {};
  const latestReport = latest(room.reports);
  const requiredRoomTypes = [
    "planning",
    "drama_conflict",
    "casual_hangout",
    "fandom_rp",
    "study_work",
    "advice",
    "game_night",
    "debate",
    "support_emotional",
  ];
  const scenarioRoomTypes = new Set(
    Array.isArray(room.scenarios) ? room.scenarios.map((scenario) => scenario.roomType) : [],
  );
  const ok =
    room.policyMode === "improved" &&
    requiredRoomTypes.every((roomType) => scenarioRoomTypes.has(roomType)) &&
    Array.isArray(room.reports) &&
    room.reports.length >= 2 &&
    Array.isArray(latestReport && latestReport.comparison) &&
    latestReport.comparison.length > 0 &&
    Array.isArray(room.routingDecisions) &&
    room.routingDecisions.length > 0 &&
    Array.isArray(room.decisions) &&
    room.decisions.some((decision) => decision.route && decision.route.routingDecisionId);

  return {
    name: "demo:before-after-loop",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `${room.reports.length} reports, ${latestReport.comparison.length} comparison rows`
      : "demo export must include all routing room types, improved run, comparison rows, routed decisions, and route metadata",
  };
}

function demoScenarioFidelityCheck(exported) {
  const room = exported.room || {};
  const transcript = Array.isArray(exported.transcript) ? exported.transcript : [];
  const runTranscripts = Array.isArray(exported.runs)
    ? exported.runs.flatMap((run) => (Array.isArray(run.transcript) ? run.transcript : []))
    : [];
  const allHumanMessages = [...transcript, ...runTranscripts].filter(
    (message) => message.senderType === "human",
  );
  const speakerNames = new Set(allHumanMessages.map((message) => message.senderName).filter(Boolean));
  const combinedText = allHumanMessages.map((message) => message.content || "").join(" ").toLowerCase();
  const ok =
    room.scenario &&
    room.scenario.id === "weekend_trip" &&
    speakerNames.size >= 4 &&
    /cheap|budget|cost/.test(combinedText) &&
    /nightlife/.test(combinedText) &&
    /nature|lake|trail|cabin/.test(combinedText) &&
    /pizza|side quest|off topic/.test(combinedText);

  return {
    name: "demo:scenario-fidelity",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `${speakerNames.size} human speakers cover budget, nightlife, nature, and a derailing beat`
      : "weekend-trip demo must include four human speakers plus budget, nightlife, nature, and derailing side-chatter evidence",
  };
}

function demoReportCheck(exported) {
  const room = exported.room || {};
  const latestReport = latest(room.reports) || {};
  const performance = latestReport.systemPerformance || {};
  const modelRouting = latestReport.modelRoutingSummary || {};
  const evidence = latestReport.evidenceManifest || {};
  const latestPlan = modelRouting.latestPlan || {};
  const agentReports = Array.isArray(latestReport.agents) ? latestReport.agents : [];
  const ok =
    room.agentSelectionRules &&
    room.agentSelectionRules.min === 2 &&
    room.agentSelectionRules.max === 3 &&
    performance.roomsTracked !== undefined &&
    performance.p99FirstTokenLatencyMs !== undefined &&
    performance.p99FullResponseLatencyMs !== undefined &&
    latestPlan.decision &&
    latestPlan.decision.tier === "fast" &&
    latestPlan.router &&
    latestPlan.router.tier === "fast" &&
    latestPlan.report &&
    latestPlan.report.tier === "strong" &&
    evidence.scenario &&
    evidence.scenario.roomType &&
    evidence.transcript &&
    evidence.transcript.messages > 0 &&
    evidence.decisions &&
    evidence.decisions.agentDecisions > 0 &&
    evidence.feedback &&
    evidence.feedback.messageFeedback >= 0 &&
    evidence.latency &&
    evidence.latency.responseLatencySamples >= 0 &&
    Array.isArray(evidence.agentConfigs) &&
    evidence.agentConfigs.length >= 2 &&
    Array.isArray(room.routingDecisions) &&
    room.routingDecisions.every((decision) => decision.modelRouting && decision.modelRouting.decision) &&
    agentReports.every(
      (agent) =>
        agent.stats &&
        "replyTargetRate" in agent.stats &&
        "targetedDecisionRate" in agent.stats &&
        "wrongPersonFeedbackRate" in agent.stats &&
        "humanConversationDelta" in agent.stats &&
        "humanConversationLift" in agent.stats &&
        "humanMomentumDirection" in agent.stats &&
        agent.stats.targetUserCounts &&
        agent.decisionReview &&
        agent.decisionReview.shouldHaveSpoken &&
        Array.isArray(agent.decisionReview.sampledDecisions),
    ) &&
    agentReports.every((agent) => agent.routingScores && agent.routingRecommendation) &&
    agentReports.some(
      (agent) => agent.routingRecommendation && agent.routingRecommendation.sessionFeedback,
    );

  return {
    name: "demo:report-contract",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `${agentReports.length} agent reports include routing, performance, model-routing, eval-input, and decision-review evidence`
      : "latest report missing agent selection rules, model routing, eval-input manifest, targeting stats, decision review, routing feedback, routing scores, or system performance fields",
  };
}

function demoExportCheck(exported) {
  const transcript = Array.isArray(exported.transcript) ? exported.transcript : [];
  const aiTranscript = transcript.filter((message) => message.senderType === "ai");
  const archivedTranscript = Array.isArray(exported.runs)
    ? exported.runs.flatMap((run) => (Array.isArray(run.transcript) ? run.transcript : []))
    : [];
  const humanTranscript = [...transcript, ...archivedTranscript].filter(
    (message) => message.senderType === "human",
  );
  const runs = Array.isArray(exported.runs) ? exported.runs : [];
  const baselineRun = runs.find((run) => run.policyMode === "baseline");
  const improvedRun = runs.find((run) => run.policyMode === "improved");
  const ok =
    exported.exportedAt &&
    exported.room &&
    transcript.length > 0 &&
    runs.length >= 2 &&
    baselineRun &&
    Array.isArray(baselineRun.transcript) &&
    baselineRun.transcript.length > 0 &&
    Array.isArray(baselineRun.reports) &&
    baselineRun.reports.length > 0 &&
    improvedRun &&
    Array.isArray(improvedRun.transcript) &&
    improvedRun.transcript.length > 0 &&
    Array.isArray(improvedRun.reports) &&
    improvedRun.reports.length > 0 &&
    transcript.every((message) => "senderId" in message) &&
    transcript.every((message) => "feedbackTags" in message) &&
    transcript.every((message) => "replyToMessageId" in message) &&
    humanTranscript.every(
      (message) => Array.isArray(message.feedbackTags) && message.feedbackTags.length === 0,
    ) &&
    transcript.some((message) => message.replyToMessageId) &&
    aiTranscript.every(
      (message) =>
        message.senderId &&
        message.decisionId &&
        Number.isFinite(message.latencyMs) &&
        Number.isFinite(message.tokenCount) &&
        "firstTokenLatencyMs" in message &&
        "latency_ms" in message &&
        "token_count" in message &&
        message.modelName &&
        message.promptVersion &&
        message.policyVersion,
    );

  return {
    name: "demo:export-contract",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `${transcript.length} current transcript messages plus ${runs.length} run snapshots exported`
      : "export JSON missing transcript/sender/latency/token/reply/model, AI-only feedback, or before-after run archive evidence",
  };
}

function targetLoadArtifactChecks() {
  const artifactPath = process.env.TARGET_LOAD_ARTIFACT || path.join("demo-artifacts", "target-load-latest.json");
  if (!fs.existsSync(artifactPath)) {
    return [
      {
        name: "perf:target-load-artifact",
        status: "fail",
        detail: `run npm run load-test:target-artifact to create ${artifactPath}`,
      },
    ];
  }

  let result;
  try {
    result = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch (error) {
    return [
      {
        name: "perf:target-load-artifact",
        status: "fail",
        detail: `invalid JSON in ${artifactPath}: ${error.message}`,
      },
    ];
  }

  const fresh = artifactFreshAfterHead(artifactPath);
  const ok =
    result.passed === true &&
    result.roomCount >= 100 &&
    result.usersPerRoom >= 3 &&
    result.messagesSent >= 1000 &&
    result.aiAgentsSimulated >= 300 &&
    result.reportsReady === result.roomCount &&
    result.socketsOpened >= 300 &&
    result.socketCloses === result.socketsOpened &&
    result.unexpectedSocketCloses === 0 &&
    result.errors === 0 &&
    result.firstTokenSamples > 0 &&
    result.feedbackSamples >= result.roomCount &&
    result.messageFanoutSamples >= result.messagesSent &&
    Number.isFinite(result.p50MessageFanoutMs) &&
    Number.isFinite(result.p95MessageFanoutMs) &&
    Number.isFinite(result.p99MessageFanoutMs) &&
    Number.isFinite(result.p95MessageAckMs) &&
    Number.isFinite(result.p99MessageAckMs) &&
    Number.isFinite(result.p95FirstTokenLatencyMs) &&
    Number.isFinite(result.p99FirstTokenLatencyMs) &&
    Number.isFinite(result.p95FeedbackAckMs) &&
    Number.isFinite(result.p99FeedbackAckMs) &&
    Number.isFinite(result.p95ReportLatencyMs) &&
    Number.isFinite(result.p99ReportLatencyMs);

  return [
    {
      name: "perf:target-load-artifact",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `${result.roomCount} rooms, ${result.messagesSent} messages, ${result.socketsOpened} sockets, ${result.reportsReady} reports, p99 fanout ${result.p99MessageFanoutMs} ms`
        : "target load artifact does not prove 100 rooms, 300 users, 300 AI agents, 1000 messages, full fanout p50/p95/p99, p99 first-token/feedback/report latencies, reports, feedback, and clean socket closure",
    },
    {
      name: "perf:fresh-after-head",
      status: fresh ? "pass" : "fail",
      detail: fresh ? "target load artifact was generated after the latest load/runtime commit" : "rerun npm run load-test:target-artifact",
    },
  ];
}

function artifactFreshAfterHead(artifactPath) {
  const commitMs = latestCommitMsFor([
    "src",
    "scripts/load-test.js",
    "scripts/run-target-load.js",
  ]);
  return fs.statSync(artifactPath).mtimeMs >= commitMs;
}

function latestCommitMsFor(paths) {
  try {
    const output = execFileSync("git", ["log", "-1", "--format=%ct", "--", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) return Number(output) * 1000;
  } catch (error) {
    // Fall through to HEAD-level freshness when path-specific history is unavailable.
  }
  return Number(execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim()) * 1000;
}

function latest(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}

function envUrlCheck(name, label) {
  const value = process.env[name] || "";
  const valid = /^https?:\/\/[^ ]+\.[^ ]+/.test(value);
  return {
    name: `link:${name}`,
    status: valid ? "pass" : "fail",
    detail: valid ? `${label}: ${value}` : `set ${name} to the ${label} URL`,
  };
}

main();
