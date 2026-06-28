const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  addHumanMessage,
  addSessionFeedback,
  buildReport,
  createAgentDecisions,
  createAgentPlaceholder,
  createRoom,
  finalizeAgentMessage,
  routeAgentDecisions,
} = require("../src/core");
const { FileStorage, MemoryStorage, _internals } = require("../src/storage");

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "socialrl-storage-"));
  const storagePath = path.join(tempDir, "rooms.json");
  const storage = new FileStorage(storagePath);
  const room = createRoom("persisted-room", {
    scenarioId: "group_project",
    agentIds: ["mediator_v1", "observer_v1"],
  });

  const triggerMessage = addHumanMessage(room, "Mina", "We need to decide what ships tomorrow.");
  const decisions = routeAgentDecisions(room, triggerMessage, createAgentDecisions(room, triggerMessage));
  const speaker = decisions.find((decision) => decision.decision === "speak") || decisions[0];
  const aiMessage = createAgentPlaceholder(room, speaker.agentId, speaker.id);
  aiMessage.firstTokenLatencyMs = 42;
  finalizeAgentMessage(aiMessage, "What absolutely has to ship by tomorrow?", 250);
  room.reportJobs.push({
    id: "job-1",
    roomId: room.id,
    source: "storage-test",
    status: "completed",
    queuedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    latencyMs: 123,
    queueDepthAtEnqueue: 1,
    reportId: "report-1",
    error: null,
  });
  addSessionFeedback(
    room,
    {
      mostUsefulAgentId: "mediator_v1",
      routeNextAgentId: "observer_v1",
      humansTalkedMoreOrLess: "more",
    },
    "test-user",
  );
  const report = buildReport(room);
  assert.ok(report.agents.every((agentReport) => agentReport.decisionReview));
  room.activePolicyOverrides = {
    observer_v1: "Speak only when the quiet participant needs to be included.",
  };
  await storage.saveRoom(room);

  const loaded = await storage.loadRooms();
  assert.ok(loaded.has("persisted-room"));
  const restored = loaded.get("persisted-room");
  assert.equal(restored.scenario.id, "group_project");
  assert.deepEqual(restored.selectedAgentIds, ["mediator_v1", "observer_v1"]);
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.messages.find((message) => message.senderType === "ai").firstTokenLatencyMs, 42);
  assert.equal(restored.routingDecisions.length, 1);
  assert.equal(restored.reportJobs[0].id, "job-1");
  assert.equal(restored.sessionFeedback[0].routeNextAgentId, "observer_v1");
  assert.equal(
    restored.activePolicyOverrides.observer_v1,
    "Speak only when the quiet participant needs to be included.",
  );
  assert.ok(restored.participants instanceof Map);

  const memoryStorage = new MemoryStorage();
  await memoryStorage.saveRoom(room);
  const memoryRooms = await memoryStorage.loadRooms();
  assert.equal(memoryRooms.get("persisted-room").messages.length, 2);
  assert.equal(
    memoryRooms.get("persisted-room").messages.find((message) => message.senderType === "ai").firstTokenLatencyMs,
    42,
  );

  const fakeClient = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [] };
    },
  };
  await _internals.replaceNormalizedRoom(fakeClient, room);
  const writtenTables = fakeClient.queries.map((entry) => entry.sql);
  assert.ok(writtenTables.some((sql) => sql.startsWith("insert into rooms")));
  assert.ok(writtenTables.some((sql) => sql.startsWith("insert into messages")));
  assert.ok(writtenTables.some((sql) => sql.startsWith("insert into agents")));
  const aiMessageWrite = fakeClient.queries.find(
    (entry) => entry.sql.startsWith("insert into messages") && entry.params[4] === "ai",
  );
  assert.ok(aiMessageWrite);
  assert.ok(aiMessageWrite.sql.includes("first_token_latency_ms"));
  assert.equal(aiMessageWrite.params[8], triggerMessage.id);
  assert.equal(aiMessageWrite.params[10], 250);
  assert.equal(aiMessageWrite.params[11], 42);
  const routingDecisionWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into routing_decisions"),
  );
  assert.ok(routingDecisionWrite);
  assert.equal(routingDecisionWrite.params[1], "persisted-room");
  assert.ok(routingDecisionWrite.sql.includes("model_routing"));
  const persistedRouteModelRouting = JSON.parse(routingDecisionWrite.params[10]);
  assert.equal(persistedRouteModelRouting.decision.tier, "fast");
  assert.ok(routingDecisionWrite.params[11].includes("agentId"));
  assert.ok(Array.isArray(routingDecisionWrite.params[12]));
  const agentDecisionWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into agent_decisions"),
  );
  assert.ok(agentDecisionWrite);
  assert.ok(agentDecisionWrite.sql.includes("model_routing"));
  const persistedDecisionModelRouting = JSON.parse(agentDecisionWrite.params[14]);
  assert.equal(persistedDecisionModelRouting.decision.tier, "fast");
  const reportJobWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into report_jobs"),
  );
  assert.ok(reportJobWrite);
  assert.equal(reportJobWrite.params[0], "job-1");
  assert.equal(reportJobWrite.params[3], "completed");
  assert.equal(reportJobWrite.params[8], 1);
  const sessionFeedbackWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into session_feedback"),
  );
  assert.ok(sessionFeedbackWrite);
  assert.ok(sessionFeedbackWrite.sql.includes("route_next_agent_id"));
  assert.ok(sessionFeedbackWrite.params.includes("observer_v1"));
  const roomReportWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into room_reports"),
  );
  assert.ok(roomReportWrite);
  assert.ok(roomReportWrite.sql.includes("model_routing_summary"));
  const persistedModelRoutingSummary = JSON.parse(roomReportWrite.params[7]);
  assert.equal(persistedModelRoutingSummary.latestPlan.report.tier, "strong");
  const agentReportWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into agent_reports"),
  );
  assert.ok(agentReportWrite);
  assert.ok(agentReportWrite.sql.includes("decision_review"));
  const persistedDecisionReview = JSON.parse(agentReportWrite.params[8]);
  assert.ok(persistedDecisionReview.summary);
  assert.ok(Array.isArray(persistedDecisionReview.sampledDecisions));
  assert.ok(writtenTables.some((sql) => sql.startsWith("delete from participants")));
  const participantWrites = fakeClient.queries.filter((entry) =>
    entry.sql.startsWith("insert into participants"),
  );
  assert.equal(participantWrites.length, 2);
  assert.deepEqual(
    participantWrites.map((entry) => entry.params[3]),
    ["ai", "ai"],
  );
  assert.deepEqual(
    participantWrites.map((entry) => entry.params[4]).sort(),
    ["mediator_v1", "observer_v1"],
  );

  await fs.rm(tempDir, { recursive: true, force: true });
  console.log("storage tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
