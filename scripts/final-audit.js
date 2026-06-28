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
    latestDemoArtifactCheck(),
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

function latestDemoArtifactCheck() {
  const dir = path.join(process.cwd(), "demo-artifacts");
  if (!fs.existsSync(dir)) {
    return { name: "demo:latest-artifacts", status: "fail", detail: "demo-artifacts missing" };
  }

  const links = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith("-links.md"))
    .map((file) => ({ file, stat: fs.statSync(path.join(dir, file)) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (!links.length) {
    return { name: "demo:latest-artifacts", status: "fail", detail: "run npm run demo:seed" };
  }

  const latestLinks = links[0].file;
  const roomId = latestLinks.replace(/-links\.md$/, "");
  const exportPath = path.join(dir, `${roomId}-export.json`);
  return {
    name: "demo:latest-artifacts",
    status: fs.existsSync(exportPath) ? "pass" : "fail",
    detail: fs.existsSync(exportPath) ? `${latestLinks} + export JSON` : `${latestLinks} has no export JSON`,
  };
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
