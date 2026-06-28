const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const localToolsDir = path.join(projectRoot, ".local-tools");
const playwrightDir = path.join(localToolsDir, "playwright");
const browsersDir = path.join(localToolsDir, "ms-playwright");
const videosDir = path.join(localToolsDir, "videos");
const previewsDir = path.join(localToolsDir, "previews");
const mp4Path = path.join(projectRoot, "docs", "assets", "socialrl-demo.mp4");
const gifPath = path.join(projectRoot, "docs", "assets", "socialrl-demo.gif");
const palettePath = path.join(previewsDir, "socialrl-demo-palette.png");

const port = Number(process.env.DEMO_PORT || 3102);
const baseUrl = process.env.DEMO_BASE_URL || `http://127.0.0.1:${port}`;
const roomId = process.env.DEMO_ROOM_ID || `record-demo-${Date.now()}`;
const playwrightVersion = process.env.DEMO_PLAYWRIGHT_VERSION || "1.61.1";
const skipSeed = process.env.DEMO_SKIP_SEED === "1";
const startsLocalServer = !process.env.DEMO_BASE_URL;

async function main() {
  await ensureDirectories();
  ensureFfmpeg();
  const { chromium } = await ensurePlaywright();

  let server = null;
  try {
    if (startsLocalServer) {
      server = startServer();
      await waitForReady(`${baseUrl}/api/ready`, 15000);
    }

    if (!skipSeed) {
      runNode(["scripts/demo-seed.js"], {
        DEMO_BASE_URL: baseUrl,
        DEMO_ROOM_ID: roomId,
      });
    }

    const sourceVideo = await recordDemo(chromium);
    convertVideo(sourceVideo);
    console.log(
      JSON.stringify(
        {
          roomId,
          baseUrl,
          sourceVideo: path.relative(projectRoot, sourceVideo),
          mp4: path.relative(projectRoot, mp4Path),
          gif: path.relative(projectRoot, gifPath),
        },
        null,
        2,
      ),
    );
  } finally {
    stopProcess(server);
  }
}

async function ensureDirectories() {
  await fsp.mkdir(playwrightDir, { recursive: true });
  await fsp.mkdir(browsersDir, { recursive: true });
  await fsp.mkdir(videosDir, { recursive: true });
  await fsp.mkdir(previewsDir, { recursive: true });
}

function ensureFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("ffmpeg is required to regenerate docs/assets/socialrl-demo.mp4 and .gif.");
  }
}

async function ensurePlaywright() {
  const packagePath = path.join(playwrightDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    await fsp.writeFile(
      packagePath,
      `${JSON.stringify({ private: true, dependencies: {} }, null, 2)}\n`,
    );
  }

  try {
    require.resolve("playwright", { paths: [playwrightDir] });
  } catch {
    run("npm", ["install", "--prefix", playwrightDir, `playwright@${playwrightVersion}`]);
  }

  const playwrightCli = path.join(playwrightDir, "node_modules", "playwright", "cli.js");
  run(process.execPath, [playwrightCli, "install", "chromium"], {
    env: { PLAYWRIGHT_BROWSERS_PATH: browsersDir },
  });

  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  return require(require.resolve("playwright", { paths: [playwrightDir] }));
}

function startServer() {
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SOCIALRL_STORAGE: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  server.stdout.on("data", (chunk) => log.push(chunk.toString()));
  server.stderr.on("data", (chunk) => log.push(chunk.toString()));
  server.on("exit", (code) => {
    if (code !== null && code !== 0) {
      const recent = log.join("").trim();
      if (recent) console.error(recent);
    }
  });
  return server;
}

async function recordDemo(chromium) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videosDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();

  await page.addInitScript(() => {
    window.localStorage.setItem("socialrl_debug_panel", "hidden");
  });

  await page.goto(`${baseUrl}/rooms/${roomId}`, { waitUntil: "networkidle" });
  await annotate(
    page,
    "Normal chat view",
    "The message list owns the scroll area and the compact composer stays pinned low instead of expanding into the page.",
  );
  await page.waitForTimeout(4200);

  await page.locator("#debugToggleButton").click({ timeout: 5000 });
  await annotate(
    page,
    "Collapsed eval rail",
    "Setup actions, participants, policies, decisions, metrics, and reports stay tucked into the right-side accordion by default.",
  );
  await page.waitForTimeout(2400);

  await openPanel(page, "Room Setup");
  await annotate(
    page,
    "Room setup collapses too",
    "Run controls, report actions, export, and navigation now live inside the Room Setup section instead of staying permanently open.",
  );
  await page.waitForTimeout(3200);

  await openPanel(page, "Participants");
  await annotate(
    page,
    "Right-side sections open on demand",
    "Participants, policies, decisions, metrics, and reports expand in the right rail without taking over the whole page.",
  );
  await page.waitForTimeout(2400);

  await openPanel(page, "Active Policies");
  await page.waitForTimeout(2200);

  await openPanel(page, "Room Metrics");
  await page.waitForTimeout(2200);

  await openPanel(page, "Agent Report");
  await annotate(
    page,
    "Scrollable report panel",
    "Expanded right-side panels scroll internally, so the page stays anchored while report evidence remains accessible.",
  );
  await page.waitForTimeout(2400);
  await page.locator("details.report-section .panel-body").evaluate((element) => {
    element.scrollTop = Math.round(element.scrollHeight * 0.45);
  });
  await page.waitForTimeout(3000);

  await page.goto(`${baseUrl}/rooms/${roomId}/report`, { waitUntil: "networkidle" });
  await annotate(
    page,
    "Agent Performance Report",
    "Reports turn transcript, decisions, feedback, latency, and routing evidence into scores, policy diffs, and before/after comparison.",
  );
  await page.waitForTimeout(6500);

  await page.goto(`${baseUrl}/rooms/${roomId}/agents/mediator_v1`, { waitUntil: "networkidle" });
  await annotate(
    page,
    "Agent-specific review",
    "Each agent gets stats, best/worst messages, decision review, routing recommendation, and the updated participation policy.",
  );
  await page.waitForTimeout(6200);

  await context.close();
  await browser.close();
  return video.path();
}

async function annotate(page, title, subtitle) {
  await page.evaluate(
    ({ title, subtitle }) => {
      let box = document.querySelector("[data-demo-caption]");
      if (!box) {
        box = document.createElement("div");
        box.setAttribute("data-demo-caption", "true");
        Object.assign(box.style, {
          position: "fixed",
          left: "24px",
          top: "118px",
          zIndex: 999999,
          maxWidth: "560px",
          padding: "12px 16px",
          borderRadius: "8px",
          background: "rgba(9, 17, 28, 0.92)",
          color: "#f8fafc",
          fontFamily:
            'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: "0 16px 48px rgba(0,0,0,0.32)",
          border: "1px solid rgba(255,255,255,0.16)",
        });
        document.body.appendChild(box);
      }
      box.replaceChildren();
      const heading = document.createElement("div");
      heading.textContent = title;
      Object.assign(heading.style, {
        fontSize: "17px",
        fontWeight: "700",
        marginBottom: "5px",
      });
      const body = document.createElement("div");
      body.textContent = subtitle;
      Object.assign(body.style, {
        fontSize: "13px",
        lineHeight: "1.4",
        color: "#cbd5e1",
      });
      box.append(heading, body);
    },
    { title, subtitle },
  );
}

async function openPanel(page, title) {
  const section = page
    .locator("details.panel-section", {
      has: page.locator(`summary h2:text-is("${title}")`),
    })
    .first();
  await section.waitFor({ state: "attached", timeout: 5000 });
  const isOpen = await section.evaluate((element) => element.open);
  if (!isOpen) {
    await section.locator("summary").click({ timeout: 5000 });
  }
}

function convertVideo(sourceVideo) {
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "warning",
    "-i",
    sourceVideo,
    "-vf",
    "scale=1280:720:flags=lanczos,fps=30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    mp4Path,
  ]);
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "warning",
    "-i",
    sourceVideo,
    "-vf",
    "fps=7,scale=960:-1:flags=lanczos,palettegen=max_colors=96",
    "-frames:v",
    "1",
    "-update",
    "1",
    palettePath,
  ]);
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "warning",
    "-i",
    sourceVideo,
    "-i",
    palettePath,
    "-filter_complex",
    "fps=7,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
    gifPath,
  ]);
}

function runNode(args, env = {}) {
  run(process.execPath, args, { env });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function waitForReady(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReady(url)) return;
    await wait(150);
  }
  throw new Error(`Timed out waiting for local server on ${url}`);
}

function isReady(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
