const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
const WebSocket = require("ws");

const baseUrl = process.env.DEMO_BASE_URL || "http://localhost:3000";
const wsUrl = baseUrl.replace(/^http/, "ws");
const roomId = process.env.DEMO_ROOM_ID || `final-demo-${Date.now()}`;
const artifactDir = path.join(__dirname, "..", "demo-artifacts");

async function main() {
  const socket = await connect(roomId);

  socket.send({
    type: "create_room",
    room_id: roomId,
    scenario_id: "weekend_trip",
    agent_ids: ["mediator_v1", "vibe_friend_v1", "observer_v1"],
    display_name: "Demo Host",
  });
  await socket.waitFor((state) => state.id === roomId);

  socket.send({ type: "run_sample_session" });
  await socket.waitFor((state) => state.status === "ended" && state.reports.length === 1);

  socket.send({ type: "apply_improved_policy" });
  await socket.waitFor((state) => state.policyMode === "improved" && state.status === "active");

  socket.send({ type: "run_sample_session" });
  const finalState = await socket.waitFor(
    (state) => state.status === "ended" && state.reports.length === 2,
    30000,
  );

  const exported = await fetchJson(`/api/rooms/${roomId}/export`);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, `${roomId}-export.json`),
    JSON.stringify(exported, null, 2),
  );
  await fs.writeFile(path.join(artifactDir, `${roomId}-links.md`), linksMarkdown(roomId, finalState));

  socket.close();

  console.log(
    JSON.stringify(
      {
        roomId,
        chatUrl: `${baseUrl}/rooms/${roomId}`,
        reportUrl: `${baseUrl}/rooms/${roomId}/report`,
        agentReviewUrl: `${baseUrl}/rooms/${roomId}/agents/mediator_v1`,
        exportPath: `demo-artifacts/${roomId}-export.json`,
        linksPath: `demo-artifacts/${roomId}-links.md`,
        reports: finalState.reports.length,
        messages: finalState.messages.length,
      },
      null,
      2,
    ),
  );
}

function connect(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?room=${encodeURIComponent(roomId)}`);
    const client = {
      latestState: null,
      waiters: [],
      send(payload) {
        ws.send(JSON.stringify(payload));
      },
      close() {
        ws.close();
      },
      waitFor(predicate, timeoutMs = 20000) {
        if (this.latestState && predicate(this.latestState)) {
          return Promise.resolve(this.latestState);
        }
        return new Promise((waitResolve, waitReject) => {
          const timeout = setTimeout(() => {
            waitReject(new Error("Timed out waiting for demo state."));
          }, timeoutMs);
          this.waiters.push({ predicate, resolve: waitResolve, reject: waitReject, timeout });
        });
      },
    };

    ws.on("open", () => resolve(client));
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type !== "state_snapshot") return;
      client.latestState = event;
      client.waiters = client.waiters.filter((waiter) => {
        if (!waiter.predicate(event)) return true;
        clearTimeout(waiter.timeout);
        waiter.resolve(event);
        return false;
      });
    });
    ws.on("error", reject);
  });
}

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    const client = baseUrl.startsWith("https:") ? https : http;
    client
      .get(`${baseUrl}${urlPath}`, (res) => {
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

function linksMarkdown(id, state) {
  const latestReport = state.reports[state.reports.length - 1];
  return `# SocialRL Arena Demo Room

- Chat: ${baseUrl}/rooms/${id}
- Report: ${baseUrl}/rooms/${id}/report
- Mediator Agent Review: ${baseUrl}/rooms/${id}/agents/mediator_v1
- Export: ${baseUrl}/api/rooms/${id}/export

## Summary

- Reports: ${state.reports.length}
- Latest report: ${latestReport.id}
- Messages in improved run: ${state.messages.length}
- Routing decisions in improved run: ${state.routingDecisions.length}
- Policy mode: ${state.policyMode}
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
