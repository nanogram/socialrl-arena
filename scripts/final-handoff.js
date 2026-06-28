const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const artifactDir = path.join(__dirname, "..", "demo-artifacts");
const outputPath = path.join(artifactDir, "final-handoff.md");

function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const demo = latestDemo();
  const targetLoad = readJson(path.join(artifactDir, "target-load-latest.json"));
  const audit = runFinalAudit();
  const generatedAt = new Date().toISOString();

  fs.writeFileSync(
    outputPath,
    [
      "# SocialRL Arena Final Handoff",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Repository",
      "",
      `- Commit: ${git(["log", "-1", "--oneline"]) || "unknown"}`,
      `- Origin: ${git(["remote", "get-url", "origin"]) || "pending"}`,
      "",
      "## External Links",
      "",
      `- Live demo: ${process.env.LIVE_DEMO_URL || "pending"}`,
      `- GitHub repo: ${process.env.GITHUB_REPO_URL || "pending"}`,
      `- Loom: ${process.env.LOOM_URL || "pending"}`,
      "",
      "## Latest Local Demo",
      "",
      ...demoLines(demo),
      "",
      "## Target Load Evidence",
      "",
      ...targetLoadLines(targetLoad),
      "",
      "## Final Audit",
      "",
      ...auditLines(audit),
      "",
      "## Reviewer Path",
      "",
      "1. Open the chat URL and show the normal room loop.",
      "2. Toggle debug/eval view and show routing, decisions, feedback, latency, policy, and model-step telemetry.",
      "3. End the session or use the seeded report URL to show the Shape Performance Report.",
      "4. Open the Mediator Shape Review and export JSON.",
      "5. Mention the target-load artifact and complete the external links before final submission.",
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify({ outputPath: path.relative(process.cwd(), outputPath) }, null, 2));
}

function latestDemo() {
  if (!fs.existsSync(artifactDir)) return null;
  const links = fs
    .readdirSync(artifactDir)
    .filter((file) => file.endsWith("-links.md"))
    .map((file) => ({ file, stat: fs.statSync(path.join(artifactDir, file)) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (!links.length) return null;

  const roomId = links[0].file.replace(/-links\.md$/, "");
  const exportPath = path.join(artifactDir, `${roomId}-export.json`);
  const exported = readJson(exportPath);
  const room = exported && exported.room ? exported.room : {};
  const latestReport = Array.isArray(room.reports) ? room.reports[room.reports.length - 1] : null;

  return {
    roomId,
    linksPath: path.join(artifactDir, links[0].file),
    exportPath,
    exported,
    latestReport,
  };
}

function demoLines(demo) {
  if (!demo || !demo.exported) {
    return ["- Status: pending. Run `npm run demo:seed` while the app is running."];
  }

  const room = demo.exported.room || {};
  const transcript = Array.isArray(demo.exported.transcript) ? demo.exported.transcript : [];
  const routingDecisions = Array.isArray(room.routingDecisions) ? room.routingDecisions : [];

  return [
    `- Room: ${demo.roomId}`,
    `- Chat: http://localhost:3000/rooms/${demo.roomId}`,
    `- Report: http://localhost:3000/rooms/${demo.roomId}/report`,
    `- Mediator Shape Review: http://localhost:3000/rooms/${demo.roomId}/shapes/mediator_v1`,
    `- Export: http://localhost:3000/api/rooms/${demo.roomId}/export`,
    `- Reports: ${Array.isArray(room.reports) ? room.reports.length : 0}`,
    `- Latest report: ${demo.latestReport ? demo.latestReport.id : "pending"}`,
    `- Messages in current transcript: ${transcript.length}`,
    `- Routing decisions: ${routingDecisions.length}`,
    `- Policy mode: ${room.policyMode || "unknown"}`,
    `- Local artifact: ${path.relative(process.cwd(), demo.linksPath)}`,
  ];
}

function targetLoadLines(result) {
  if (!result) {
    return ["- Status: pending. Run `npm run load-test:target-artifact`."];
  }

  return [
    `- Generated: ${result.generatedAt || "unknown"}`,
    `- Passed: ${Boolean(result.passed)}`,
    `- Rooms/users/agents/messages: ${result.roomCount}/${result.roomCount * result.usersPerRoom}/${result.aiAgentsSimulated}/${result.messagesSent}`,
    `- Reports ready: ${result.reportsReady}`,
    `- Socket errors: ${result.unexpectedSocketCloses || 0} unexpected closes, ${result.errors || 0} load-test errors`,
    `- Throughput: ${result.messageThroughputPerSecond} messages/sec, ${result.reportThroughputPerSecond} reports/sec`,
    `- p95 fanout/first-token/report: ${result.p95MessageFanoutMs} ms / ${result.p95FirstTokenLatencyMs} ms / ${result.p95ReportLatencyMs} ms`,
    `- p99 fanout/first-token/report: ${result.p99MessageFanoutMs} ms / ${result.p99FirstTokenLatencyMs} ms / ${result.p99ReportLatencyMs} ms`,
    "- Local artifact: demo-artifacts/target-load-latest.json",
  ];
}

function auditLines(audit) {
  if (!audit || !Array.isArray(audit.checks)) {
    return ["- Status: unavailable. Run `npm run final-audit` for details."];
  }

  const failed = audit.checks.filter((check) => check.status !== "pass");
  return [
    `- Status: ${audit.ok ? "pass" : "pending"}`,
    `- Passing checks: ${audit.checks.length - failed.length}/${audit.checks.length}`,
    failed.length
      ? `- Pending checks: ${failed.map((check) => `${check.name} (${check.detail})`).join("; ")}`
      : "- Pending checks: none",
  ];
}

function runFinalAudit() {
  const result = spawnSync(process.execPath, [path.join(__dirname, "final-audit.js")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: process.env,
  });
  return parseJson(result.stdout);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return parseJson(fs.readFileSync(file, "utf8"));
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    return "";
  }
}

main();
