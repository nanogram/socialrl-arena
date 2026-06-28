const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { addHumanMessage, addSessionFeedback, createRoom } = require("../src/core");
const { FileStorage, MemoryStorage, _internals } = require("../src/storage");

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "socialrl-storage-"));
  const storagePath = path.join(tempDir, "rooms.json");
  const storage = new FileStorage(storagePath);
  const room = createRoom("persisted-room", {
    scenarioId: "group_project",
    agentIds: ["mediator_v1", "observer_v1"],
  });

  addHumanMessage(room, "Mina", "We need to decide what ships tomorrow.");
  addSessionFeedback(
    room,
    {
      mostUsefulAgentId: "mediator_v1",
      routeNextAgentId: "observer_v1",
      humansTalkedMoreOrLess: "more",
    },
    "test-user",
  );
  room.activePolicyOverrides = {
    observer_v1: "Speak only when the quiet participant needs to be included.",
  };
  await storage.saveRoom(room);

  const loaded = await storage.loadRooms();
  assert.ok(loaded.has("persisted-room"));
  const restored = loaded.get("persisted-room");
  assert.equal(restored.scenario.id, "group_project");
  assert.deepEqual(restored.selectedAgentIds, ["mediator_v1", "observer_v1"]);
  assert.equal(restored.messages.length, 1);
  assert.equal(restored.sessionFeedback[0].routeNextAgentId, "observer_v1");
  assert.equal(
    restored.activePolicyOverrides.observer_v1,
    "Speak only when the quiet participant needs to be included.",
  );
  assert.ok(restored.participants instanceof Map);

  const memoryStorage = new MemoryStorage();
  await memoryStorage.saveRoom(room);
  const memoryRooms = await memoryStorage.loadRooms();
  assert.equal(memoryRooms.get("persisted-room").messages.length, 1);

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
  const sessionFeedbackWrite = fakeClient.queries.find((entry) =>
    entry.sql.startsWith("insert into session_feedback"),
  );
  assert.ok(sessionFeedbackWrite);
  assert.ok(sessionFeedbackWrite.sql.includes("route_next_agent_id"));
  assert.ok(sessionFeedbackWrite.params.includes("observer_v1"));
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
