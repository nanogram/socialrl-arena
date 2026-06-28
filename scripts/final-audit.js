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
  const checks = [
    ...requiredFiles.map((file) => fileCheck(file)),
    gitRemoteCheck(),
    ...latestDemoArtifactChecks(),
    ...requiredEnvLinks.map(([name, label]) => envUrlCheck(name, label)),
  ];
  const failed = checks.filter((check) => check.status !== "pass");

  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
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
    demoReportCheck(exported),
    demoExportCheck(exported),
  ];
}

function freshArtifactCheck(exportPath, linksStat) {
  const commitMs = Number(execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim()) * 1000;
  const exportMs = fs.statSync(exportPath).mtimeMs;
  const linksMs = linksStat.mtimeMs;
  const fresh = exportMs >= commitMs && linksMs >= commitMs;
  return {
    name: "demo:fresh-after-head",
    status: fresh ? "pass" : "fail",
    detail: fresh ? "latest demo was generated after the current commit" : "rerun npm run demo:seed",
  };
}

function demoContentCheck(exported) {
  const room = exported.room || {};
  const latestReport = latest(room.reports);
  const ok =
    room.policyMode === "improved" &&
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
      : "demo export must include improved run, comparison rows, routed decisions, and route metadata",
  };
}

function demoReportCheck(exported) {
  const room = exported.room || {};
  const latestReport = latest(room.reports) || {};
  const performance = latestReport.systemPerformance || {};
  const modelRouting = latestReport.modelRoutingSummary || {};
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
    Array.isArray(room.routingDecisions) &&
    room.routingDecisions.every((decision) => decision.modelRouting && decision.modelRouting.decision) &&
    agentReports.every(
      (agent) =>
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
      ? `${agentReports.length} agent reports include routing, performance, model-routing, and decision-review evidence`
      : "latest report missing agent selection rules, model routing, decision review, routing feedback, routing scores, or system performance fields",
  };
}

function demoExportCheck(exported) {
  const transcript = Array.isArray(exported.transcript) ? exported.transcript : [];
  const aiTranscript = transcript.filter((message) => message.senderType === "ai");
  const ok =
    exported.exportedAt &&
    exported.room &&
    transcript.length > 0 &&
    transcript.every((message) => "feedbackTags" in message) &&
    aiTranscript.every(
      (message) => message.decisionId && message.modelName && message.promptVersion && message.policyVersion,
    );

  return {
    name: "demo:export-contract",
    status: ok ? "pass" : "fail",
    detail: ok ? `${transcript.length} transcript messages exported` : "export JSON missing transcript/model evidence",
  };
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
