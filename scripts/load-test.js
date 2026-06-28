const WebSocket = require("ws");

const targetUrl = process.env.LOAD_TEST_URL || "ws://localhost:3000";
const roomCount = Number(process.env.LOAD_TEST_ROOMS || 20);
const usersPerRoom = Number(process.env.LOAD_TEST_USERS_PER_ROOM || 3);
const messagesPerRoom = Number(process.env.LOAD_TEST_MESSAGES_PER_ROOM || 5);
const scenarioId = process.env.LOAD_TEST_SCENARIO || "weekend_trip";
const agentIds = ["mediator_v1", "vibe_friend_v1", "observer_v1"];
const reportTimeoutMs = Number(process.env.LOAD_TEST_REPORT_TIMEOUT_MS || 15000);
const interMessageDelayMs = Number(process.env.LOAD_TEST_INTER_MESSAGE_DELAY_MS || 30);
const settleBeforeReportMs = Number(process.env.LOAD_TEST_SETTLE_BEFORE_REPORT_MS || 1000);

async function main() {
  const startedAt = Date.now();
  const rooms = Array.from({ length: roomCount }, (_, index) => `load-room-${Date.now()}-${index}`);
  const metrics = {
    sockets: 0,
    socketCloses: 0,
    unexpectedSocketCloses: 0,
    messagesSent: 0,
    reportsReady: 0,
    reportRooms: new Set(),
    reportLatencyRooms: new Set(),
    aiMessageIds: new Set(),
    snapshots: 0,
    errors: 0,
    messageAckLatencies: [],
    firstTokenLatencies: [],
    feedbackAckLatencies: [],
    reportLatencies: [],
  };

  await Promise.all(rooms.map((roomId) => exerciseRoom(roomId, metrics)));
  const elapsedMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        targetUrl,
        roomCount,
        usersPerRoom,
        messagesPerRoom,
        aiAgentsSimulated: roomCount * agentIds.length,
        elapsedMs,
        messagesSent: metrics.messagesSent,
        reportsReady: metrics.reportRooms.size,
        socketsOpened: metrics.sockets,
        socketCloses: metrics.socketCloses,
        unexpectedSocketCloses: metrics.unexpectedSocketCloses,
        snapshots: metrics.snapshots,
        errors: metrics.errors,
        messageThroughputPerSecond: round(metrics.messagesSent / Math.max(1, elapsedMs / 1000)),
        reportThroughputPerSecond: round(metrics.reportRooms.size / Math.max(1, elapsedMs / 1000)),
        firstTokenSamples: metrics.firstTokenLatencies.length,
        feedbackSamples: metrics.feedbackAckLatencies.length,
        p50MessageAckMs: percentile(metrics.messageAckLatencies, 0.5),
        p95MessageAckMs: percentile(metrics.messageAckLatencies, 0.95),
        p50FirstTokenLatencyMs: percentile(metrics.firstTokenLatencies, 0.5),
        p95FirstTokenLatencyMs: percentile(metrics.firstTokenLatencies, 0.95),
        p50FeedbackAckMs: percentile(metrics.feedbackAckLatencies, 0.5),
        p95FeedbackAckMs: percentile(metrics.feedbackAckLatencies, 0.95),
        p50ReportLatencyMs: percentile(metrics.reportLatencies, 0.5),
        p95ReportLatencyMs: percentile(metrics.reportLatencies, 0.95),
      },
      null,
      2,
    ),
  );

  const failed =
    metrics.errors ||
    metrics.unexpectedSocketCloses ||
    metrics.reportRooms.size !== roomCount ||
    metrics.socketCloses !== metrics.sockets ||
    metrics.firstTokenLatencies.length === 0 ||
    metrics.feedbackAckLatencies.length === 0;

  if (failed) process.exit(1);
}

async function exerciseRoom(roomId, metrics) {
  const sockets = await Promise.all(
    Array.from({ length: usersPerRoom }, (_, index) => connectUser(roomId, `User ${index + 1}`, metrics)),
  );

  sockets[0].send({
    type: "create_room",
    room_id: roomId,
    scenario_id: scenarioId,
    agent_ids: agentIds,
    display_name: "Load Host",
  });
  await wait(80);

  for (let index = 0; index < messagesPerRoom; index += 1) {
    const socket = sockets[index % sockets.length];
    const displayName = `User ${(index % usersPerRoom) + 1}`;
    const content = sampleMessage(index);
    socket.pendingMessageSentAt = Date.now();
    socket.pendingMessageContent = content;
    socket.pendingMessageSender = displayName;
    socket.send({
      type: "send_message",
      display_name: displayName,
      content,
    });
    metrics.messagesSent += 1;
    await waitFor(() => !socket.pendingMessageSentAt, 5000);

    if (index === 0 && socket.lastSentHumanMessageId) {
      socket.pendingFeedbackSentAt = Date.now();
      socket.pendingFeedbackMessageId = socket.lastSentHumanMessageId;
      socket.send({
        type: "add_feedback",
        message_id: socket.lastSentHumanMessageId,
        tag: "helped_us_decide",
      });
      await waitFor(() => !socket.pendingFeedbackSentAt, 5000);
    }

    await wait(interMessageDelayMs);
  }

  await wait(settleBeforeReportMs);

  sockets[0].send({
    type: "add_session_feedback",
    most_useful_agent_id: "mediator_v1",
    route_next_agent_id: "mediator_v1",
    did_reach_decision: true,
    would_invite_again: true,
    humans_talked_more_or_less: "more",
    freeform_notes: "Synthetic load-test feedback.",
  });
  sockets[0].pendingReportSentAt = Date.now();
  sockets[0].send({ type: "end_session" });

  await waitFor(() => sockets.some((socket) => socket.reportReady), reportTimeoutMs);
  sockets.forEach((socket) => socket.close());
  await waitFor(() => sockets.every((socket) => socket.closed), 1000);
}

function connectUser(roomId, displayName, metrics) {
  return new Promise((resolve, reject) => {
    const socket = new JsonSocket(`${targetUrl}?room=${encodeURIComponent(roomId)}`, metrics);
    const timeout = setTimeout(() => reject(new Error(`Timed out connecting ${displayName}`)), 5000);
    socket.onOpen = () => {
      clearTimeout(timeout);
      metrics.sockets += 1;
      socket.send({ type: "join_room", room_id: roomId, display_name: displayName });
      resolve(socket);
    };
    socket.onError = reject;
  });
}

class JsonSocket {
  constructor(url, metrics) {
    this.ws = new WebSocket(url);
    this.metrics = metrics;
    this.reportReady = false;
    this.expectedClose = false;
    this.closed = false;
    this.pendingMessageSentAt = null;
    this.pendingMessageContent = null;
    this.pendingMessageSender = null;
    this.lastSentHumanMessageId = null;
    this.pendingFeedbackSentAt = null;
    this.pendingFeedbackMessageId = null;
    this.pendingReportSentAt = null;
    this.onOpen = null;
    this.onError = null;

    this.ws.on("open", () => this.onOpen && this.onOpen());
    this.ws.on("error", (error) => {
      this.metrics.errors += 1;
      if (this.onError) this.onError(error);
    });
    this.ws.on("close", () => {
      this.closed = true;
      this.metrics.socketCloses += 1;
      if (!this.expectedClose) this.metrics.unexpectedSocketCloses += 1;
    });
    this.ws.on("message", (raw) => this.handleMessage(raw));
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  close() {
    this.expectedClose = true;
    this.ws.close();
  }

  handleMessage(raw) {
    const event = JSON.parse(raw.toString());
    if (event.type === "state_snapshot") {
      this.metrics.snapshots += 1;
    }
    if (
      event.type === "message_created" &&
      this.pendingMessageSentAt &&
      event.message &&
      event.message.senderType === "human" &&
      event.message.senderName === this.pendingMessageSender &&
      event.message.content === this.pendingMessageContent
    ) {
      this.metrics.messageAckLatencies.push(Date.now() - this.pendingMessageSentAt);
      this.lastSentHumanMessageId = event.message.id;
      this.pendingMessageSentAt = null;
      this.pendingMessageContent = null;
      this.pendingMessageSender = null;
    }
    if (
      event.type === "feedback_added" &&
      this.pendingFeedbackSentAt &&
      (event.messageId === this.pendingFeedbackMessageId || event.message_id === this.pendingFeedbackMessageId)
    ) {
      this.metrics.feedbackAckLatencies.push(Date.now() - this.pendingFeedbackSentAt);
      this.pendingFeedbackSentAt = null;
      this.pendingFeedbackMessageId = null;
    }
    if (
      event.type === "message_stream_done" &&
      event.message &&
      event.message.senderType === "ai" &&
      !this.metrics.aiMessageIds.has(event.message.id)
    ) {
      this.metrics.aiMessageIds.add(event.message.id);
      if (Number.isFinite(event.message.firstTokenLatencyMs)) {
        this.metrics.firstTokenLatencies.push(event.message.firstTokenLatencyMs);
      }
    }
    if (event.type === "report_ready") {
      this.reportReady = true;
      const roomId = event.roomId || event.room_id || (event.report && event.report.roomId);
      this.metrics.reportRooms.add(roomId);
      this.metrics.reportsReady += 1;
      if (
        this.pendingReportSentAt &&
        roomId &&
        !this.metrics.reportLatencyRooms.has(roomId)
      ) {
        this.metrics.reportLatencyRooms.add(roomId);
        this.metrics.reportLatencies.push(Date.now() - this.pendingReportSentAt);
        this.pendingReportSentAt = null;
      }
    }
    if (event.type === "error") {
      this.metrics.errors += 1;
    }
  }
}

function sampleMessage(index) {
  const messages = [
    "I need this to stay cheap but still fun.",
    "I want nightlife, not a sleepy weekend.",
    "Could we choose between city, cabin, or lake town?",
    "I am not sure anyone is accounting for the budget.",
    "Let's vote on the constraint that matters most.",
  ];
  return messages[index % messages.length];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error("Timed out waiting for load-test condition.");
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const values = [...sorted].sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * p))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
