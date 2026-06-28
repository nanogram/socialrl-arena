const fs = require("fs");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");
const {
  addFeedback,
  addHumanMessage,
  addParticipant,
  addSessionFeedback,
  buildRoutingDecision,
  buildReport,
  createAgentDecisions,
  createAgentPlaceholder,
  createExport,
  createRoom,
  finalizeAgentMessage,
  generateAgentReply,
  recordRoutedDecisions,
  refreshLatestReport,
  resetRoomForNextRun,
  serializeRoom,
  setRoomConfig,
} = require("./core");
const { createLlmProvider } = require("./llmProvider");
const { createStorage } = require("./storage");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");
const storage = createStorage();
const llmProvider = createLlmProvider();
const rooms = new Map();
const reportQueue = [];
let reportWorkerRunning = false;

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      status: "healthy",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (requestUrl.pathname === "/api/ready") {
    sendJson(res, 200, {
      ok: true,
      status: "ready",
      rooms: rooms.size,
      websocketClients: wss ? wss.clients.size : 0,
      reportQueueDepth: reportQueue.length,
      storage: storage.name,
      llmProvider: llmProvider.name,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (requestUrl.pathname === "/api/rooms") {
    sendJson(res, 200, {
      rooms: [...rooms.values()].map(roomSummary).sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
      ),
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/rooms/")) {
    handleRoomApi(requestUrl, res);
    return;
  }

  const urlPath =
    requestUrl.pathname === "/" ||
    requestUrl.pathname === "/create" ||
    requestUrl.pathname.startsWith("/rooms/")
      ? "/index.html"
      : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDir, urlPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const requestedRoomId = requestUrl.searchParams.get("room") || roomIdFromPath(requestUrl.pathname);
  ws.id = randomUUID();
  ws.roomId = requestedRoomId || "demo-room";
  const room = ensureRoom(ws.roomId);
  ensureRuntimeMetrics(room).websocketConnections += 1;
  send(ws, "state_snapshot", snapshot(ws.roomId));

  ws.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch (error) {
      send(ws, "error", { message: "Invalid JSON event." });
      return;
    }

    handleClientEvent(ws, event).catch((error) => {
      send(ws, "error", { message: error.message || "Unexpected server error." });
    });
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomId);
    if (room && room.participants.has(ws.id)) {
      room.participants.delete(ws.id);
      ensureRuntimeMetrics(room).websocketDisconnects += 1;
      persistRoom(room);
      broadcastRoom(ws.roomId, "state_snapshot", snapshot(ws.roomId));
    }
  });
});

async function handleClientEvent(ws, event) {
  if (event.type === "create_room") {
    const requestedRoomId = normalizeRoomId(eventValue(event, "room_id", "roomId") || ws.roomId);
    const existingRoom = rooms.get(requestedRoomId);
    const canReuseRequestedRoom =
      existingRoom && existingRoom.messages.length === 0 && existingRoom.reports.length === 0;
    const roomId = canReuseRequestedRoom ? requestedRoomId : uniqueRoomId(requestedRoomId);
    const room = createRoom(roomId, {
      scenarioId: eventValue(event, "scenario_id", "scenarioId"),
      agentIds: eventValue(event, "agent_ids", "agentIds"),
    });
    rooms.set(room.id, room);
    leaveCurrentRoom(ws);
    ws.roomId = room.id;
    const participant = addParticipant(room, eventValue(event, "display_name", "displayName"), ws.id);
    ws.displayName = participant.displayName;
    await persistRoom(room);
    send(ws, "room_created", {
      room: serializeRoom(room),
      inviteUrl: `/rooms/${room.id}`,
    });
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "join_room") {
    const roomId = eventValue(event, "room_id", "roomId") || ws.roomId || "demo-room";
    const room = ensureRoom(roomId);
    if (ws.roomId !== room.id) leaveCurrentRoom(ws);
    ws.roomId = room.id;
    const participant = addParticipant(room, eventValue(event, "display_name", "displayName"), ws.id);
    ws.displayName = participant.displayName;
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  const room = resolveEventRoom(ws, event);

  if (event.type === "configure_room") {
    setRoomConfig(room, {
      scenarioId: eventValue(event, "scenario_id", "scenarioId"),
      agentIds: eventValue(event, "agent_ids", "agentIds"),
    });
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "send_message") {
    const displayName = eventValue(event, "display_name", "displayName") || ws.displayName || "Human";
    ensureParticipant(ws, room, displayName);
    const content = String(event.content || "").trim();
    if (!content) return;

    room.status = "active";
    const message = addHumanMessage(room, displayName, content);
    broadcastRoom(room.id, "message_created", messageEventPayload(message));
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    await orchestrateAgents(room, message);
    return;
  }

  if (event.type === "add_feedback") {
    const writeStarted = Date.now();
    const feedback = addFeedback(room, eventValue(event, "message_id", "messageId"), event.tag, ws.id);
    broadcastRoom(room.id, "feedback_added", feedbackEventPayload(feedback));
    await persistRoom(room);
    recordRuntimeMetric(room, "feedbackWriteLatenciesMs", Date.now() - writeStarted);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "add_session_feedback") {
    const feedback = addSessionFeedback(
      room,
      {
        mostUsefulAgentId: eventValue(event, "most_useful_agent_id", "mostUsefulAgentId"),
        mostAnnoyingAgentId: eventValue(event, "most_annoying_agent_id", "mostAnnoyingAgentId"),
        routeNextAgentId: eventValue(event, "route_next_agent_id", "routeNextAgentId"),
        didReachDecision: eventValue(event, "did_reach_decision", "didReachDecision"),
        wouldInviteAgain: eventValue(event, "would_invite_again", "wouldInviteAgain"),
        humansTalkedMoreOrLess: eventValue(event, "humans_talked_more_or_less", "humansTalkedMoreOrLess"),
        freeformNotes: eventValue(event, "freeform_notes", "freeformNotes"),
      },
      ws.id,
    );
    broadcastRoom(room.id, "session_feedback_added", sessionFeedbackEventPayload(feedback));
    if (room.status === "ended" && room.reports.length) {
      const job = enqueueReport(room, "session_feedback_refresh");
      broadcastRoom(room.id, "report_queued", reportJobEventPayload(room, job));
    }
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "end_session") {
    const job = enqueueReport(room, "manual_end_session");
    broadcastRoom(room.id, "report_queued", reportJobEventPayload(room, job));
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "apply_improved_policy") {
    let latestReport = room.reports[room.reports.length - 1] || null;
    if (room.status !== "ended") {
      latestReport = buildReport(room);
    }
    const activePolicyOverrides = latestReport
      ? Object.fromEntries(
          latestReport.agents.map((agentReport) => [
            agentReport.agentId,
            agentReport.policyDiff.after,
          ]),
        )
      : {};

    room.policyMode = "improved";
    room.sessionNumber += 1;
    resetRoomForNextRun(room, "improved");
    room.activePolicyOverrides = activePolicyOverrides;
    if (latestReport) {
      room.currentPolicyVersion = `improved_from_${latestReport.id.slice(0, 8)}`;
    }
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "reset_demo") {
    const replacement = createRoom(room.id, {
      scenarioId: room.scenario.id,
      agentIds: room.selectedAgentIds,
    });
    rooms.set(room.id, replacement);
    await persistRoom(replacement);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    return;
  }

  if (event.type === "run_sample_session") {
    await runSampleSession(room);
    return;
  }

  if (event.type === "state_request") {
    send(ws, "state_snapshot", snapshot(room.id));
    return;
  }
}

function resolveEventRoom(ws, event) {
  const requestedRoomId = eventValue(event, "room_id", "roomId");
  if (!requestedRoomId) return ensureRoom(ws.roomId);

  const room = ensureRoom(requestedRoomId);
  if (ws.roomId !== room.id) {
    leaveCurrentRoom(ws);
    ws.roomId = room.id;
  }
  return room;
}

function leaveCurrentRoom(ws) {
  const currentRoom = rooms.get(ws.roomId);
  if (!currentRoom || !currentRoom.participants.has(ws.id)) return;
  currentRoom.participants.delete(ws.id);
  ensureRuntimeMetrics(currentRoom).websocketDisconnects += 1;
  persistRoom(currentRoom);
  broadcastRoom(currentRoom.id, "state_snapshot", snapshot(currentRoom.id));
}

function ensureParticipant(ws, room, displayName) {
  if (room.participants.has(ws.id)) return;
  const participant = addParticipant(room, displayName || ws.displayName || "Human", ws.id);
  ws.displayName = participant.displayName;
}

function eventValue(event, snakeKey, camelKey) {
  return event[snakeKey] !== undefined ? event[snakeKey] : event[camelKey];
}

async function orchestrateAgents(room, triggerMessage) {
  const start = Date.now();
  getRoomAgentIds(room).forEach((agentId) => {
    broadcastRoom(room.id, "agent_thinking", {
      agent_id: agentId,
      agentId,
      room_id: room.id,
      roomId: room.id,
      trigger_message_id: triggerMessage.id,
      triggerMessageId: triggerMessage.id,
      state: "deciding_whether_to_speak",
    });
  });

  await delay(180);
  const rawDecisions = await llmProvider.decideAgents({
    room,
    triggerMessage,
    fallback: () => createAgentDecisions(room, triggerMessage),
  });
  const routeResult = await llmProvider.routeDecisions({
    room,
    triggerMessage,
    decisions: rawDecisions,
    fallback: () => buildRoutingDecision(room, triggerMessage, rawDecisions),
  });
  const decisions = recordRoutedDecisions(
    room,
    routeResult.routingDecision,
    routeResult.routedDecisions,
  );
  decisions.forEach((decision) => broadcastRoom(room.id, "agent_decision", decisionEventPayload(decision)));
  decisions
    .filter((decision) => decision.decision !== "speak")
    .forEach((decision) =>
      broadcastRoom(room.id, decision.decision === "stay_silent" ? "agent_stayed_silent" : "agent_waited", {
        agent_id: decision.agentId,
        agentId: decision.agentId,
        agent_name: decision.agentName,
        agentName: decision.agentName,
        room_id: room.id,
        roomId: room.id,
        decision: addDecisionAliases(decision),
        reason: decision.reason,
      }),
    );
  await persistRoom(room);
  broadcastRoom(room.id, "state_snapshot", snapshot(room.id));

  const speaker = decisions.find((decision) => decision.decision === "speak");
  if (!speaker) return null;

  const generated = await llmProvider.generateMessage({
    room,
    decision: speaker,
    fallback: () => generateAgentReply(room, speaker),
  });
  const generatedMessage = normalizeGeneratedMessage(generated);
  const content = generatedMessage.content;
  const message = createAgentPlaceholder(room, speaker.agentId, speaker.id);
  if (generatedMessage.modelName) message.modelName = generatedMessage.modelName;
  if (generatedMessage.promptVersion) message.promptVersion = generatedMessage.promptVersion;
  broadcastRoom(room.id, "message_created", messageEventPayload(message));
  await persistRoom(room);

  let partial = "";
  for (const chunk of chunkText(content)) {
    partial = partial ? `${partial} ${chunk}` : chunk;
    message.content = partial;
    if (!message.firstTokenLatencyMs) message.firstTokenLatencyMs = Date.now() - start;
    broadcastRoom(room.id, "message_stream_delta", {
      message_id: message.id,
      messageId: message.id,
      room_id: room.id,
      roomId: room.id,
      chunk,
      content: partial,
    });
    await delay(65);
  }

  finalizeAgentMessage(message, content, Date.now() - start);
  broadcastRoom(room.id, "message_stream_done", messageEventPayload(message));
  await persistRoom(room);
  broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
  return message;
}

async function runSampleSession(room) {
  resetRoomForNextRun(room, room.policyMode);
  await persistRoom(room);
  broadcastRoom(room.id, "state_snapshot", snapshot(room.id));

  for (const [speaker, content] of room.scenario.sampleScript) {
    const message = addHumanMessage(room, speaker, content);
    broadcastRoom(room.id, "message_created", messageEventPayload(message));
    await persistRoom(room);
    broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
    await orchestrateAgents(room, message);
    await delay(180);
  }

  applySampleFeedback(room);
  addSampleSessionFeedback(room);
  const report = await enqueueReport(room, "sample_session", { wait: true });
  broadcastRoom(room.id, "report_ready", reportReadyEventPayload(room, report));
  await persistRoom(room);
  broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
}

function applySampleFeedback(room) {
  const aiMessages = room.messages.filter((message) => message.senderType === "ai");
  aiMessages.forEach((message, index) => {
    if (room.policyMode === "baseline") {
      if (message.content.split(/\s+/).length > 24) addFeedback(room, message.id, "too_verbose", "sample");
      if (index < 2) addFeedback(room, message.id, "should_have_stayed_quiet", "sample");
      if (/vote|cheap city|cabin|lake|decid|constraint|priority/i.test(message.content)) {
        addFeedback(room, message.id, "helped_us_decide", "sample");
      }
      if (/heard|tension|listening/i.test(message.content)) {
        addFeedback(room, message.id, "reduced_tension", "sample");
      }
      return;
    }

    addFeedback(room, message.id, "good_timing", "sample");
    if (/vote|cheap city|cabin|lake|fork|constraint|overlap|priority/i.test(message.content)) {
      addFeedback(room, message.id, "helped_us_decide", "sample");
    }
    if (/heard|tension|listening/i.test(message.content)) {
      addFeedback(room, message.id, "reduced_tension", "sample");
    }
  });
}

function addSampleSessionFeedback(room) {
  addSessionFeedback(
    room,
      {
        mostUsefulAgentId: "mediator_v1",
        mostAnnoyingAgentId: room.policyMode === "baseline" ? "vibe_friend_v1" : null,
        routeNextAgentId: room.policyMode === "improved" ? "mediator_v1" : "observer_v1",
        didReachDecision: room.policyMode === "improved",
        wouldInviteAgain: room.policyMode === "improved",
        humansTalkedMoreOrLess: room.policyMode === "improved" ? "more" : "same",
      freeformNotes:
        room.policyMode === "improved"
          ? "The improved policy spoke less and made the useful intervention clearer."
          : "Baseline was useful, but it over-explained and jumped in early.",
    },
    "sample",
  );
}

function handleRoomApi(requestUrl, res) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const roomId = parts[2];
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { error: "Room not found" });
    return;
  }

  if (parts.length === 3) {
    sendJson(res, 200, serializeRoom(room));
    return;
  }

  if (parts[3] === "export") {
    handleExport(room, res);
    return;
  }

  if (parts[3] === "reports" && parts[4] === "latest") {
    const latestReport = room.reports[room.reports.length - 1] || null;
    if (!latestReport) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }
    sendJson(res, 200, latestReport);
    return;
  }

  if (parts[3] === "reports" && parts[4]) {
    const report = room.reports.find((candidate) => candidate.id === parts[4]);
    if (!report) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }
    sendJson(res, 200, report);
    return;
  }

  if (parts[3] === "shapes" && parts[4]) {
    const latestReport = room.reports[room.reports.length - 1] || null;
    const shape = latestReport
      ? latestReport.agents.find((agentReport) => agentReport.agentId === parts[4])
      : null;
    if (!shape) {
      sendJson(res, 404, { error: "Shape report not found" });
      return;
    }
    sendJson(res, 200, {
      roomId: room.id,
      reportId: latestReport.id,
      scenario: room.scenario,
      shape,
    });
    return;
  }

  sendJson(res, 404, { error: "Unknown room API route" });
}

function handleExport(room, res) {
  const body = JSON.stringify(createExport(room), null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${room.id}-export.json"`,
  });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function messageEventPayload(message) {
  const aliased = addMessageAliases(message);
  return {
    room_id: message.roomId,
    roomId: message.roomId,
    message: aliased,
  };
}

function decisionEventPayload(decision) {
  return {
    room_id: decision.roomId,
    roomId: decision.roomId,
    agent_id: decision.agentId,
    agentId: decision.agentId,
    decision: addDecisionAliases(decision),
  };
}

function feedbackEventPayload(feedback) {
  const aliased = addFeedbackAliases(feedback);
  return {
    room_id: feedback.roomId,
    roomId: feedback.roomId,
    message_id: feedback.messageId,
    messageId: feedback.messageId,
    feedback: aliased,
  };
}

function sessionFeedbackEventPayload(feedback) {
  return {
    room_id: feedback.roomId,
    roomId: feedback.roomId,
    feedback: {
      ...feedback,
      room_id: feedback.roomId,
      user_id: feedback.userId,
      most_useful_agent_id: feedback.mostUsefulAgentId,
      most_annoying_agent_id: feedback.mostAnnoyingAgentId,
      route_next_agent_id: feedback.routeNextAgentId,
      did_reach_decision: feedback.didReachDecision,
      would_invite_again: feedback.wouldInviteAgain,
      humans_talked_more_or_less: feedback.humansTalkedMoreOrLess,
      freeform_notes: feedback.freeformNotes,
      created_at: feedback.createdAt,
    },
  };
}

function reportJobEventPayload(room, job) {
  return {
    room_id: room.id,
    roomId: room.id,
    job: addReportJobAliases(job),
  };
}

function reportReadyEventPayload(room, report, job = null) {
  return {
    room_id: room.id,
    roomId: room.id,
    report_id: report.id,
    reportId: report.id,
    report_url: `/rooms/${room.id}/report`,
    reportUrl: `/rooms/${room.id}/report`,
    report,
    ...(job ? { job: addReportJobAliases(job) } : {}),
  };
}

function addMessageAliases(message) {
  return {
    ...message,
    room_id: message.roomId,
    sender_name: message.senderName,
    sender_type: message.senderType,
    agent_id: message.agentId,
    created_at: message.createdAt,
    reply_to_message_id: message.replyToMessageId,
    decision_id: message.decisionId,
    latency_ms: message.latencyMs,
    first_token_latency_ms: message.firstTokenLatencyMs,
    token_count: message.tokenCount,
    model_name: message.modelName,
    prompt_version: message.promptVersion,
    policy_version: message.policyVersion,
    feedback: Array.isArray(message.feedback) ? message.feedback.map(addFeedbackAliases) : [],
  };
}

function addDecisionAliases(decision) {
  return {
    ...decision,
    room_id: decision.roomId,
    trigger_message_id: decision.triggerMessageId,
    agent_id: decision.agentId,
    agent_name: decision.agentName,
    target_user: decision.targetUser,
    group_state: decision.groupState,
    room_type: decision.roomType,
    model_name: decision.modelName,
    model_routing: decision.modelRouting,
    prompt_version: decision.promptVersion,
    policy_version: decision.policyVersion,
    created_at: decision.createdAt,
    route: decision.route ? addRouteAliases(decision.route) : decision.route,
  };
}

function addRouteAliases(route) {
  return {
    ...route,
    routing_decision_id: route.routingDecisionId,
    router_version: route.routerVersion,
    router_model_name: route.routerModelName,
    model_routing: route.modelRouting,
    room_type: route.roomType,
    group_state: route.groupState,
    selected_agent_id: route.selectedAgentId,
  };
}

function addFeedbackAliases(feedback) {
  return {
    ...feedback,
    message_id: feedback.messageId,
    room_id: feedback.roomId,
    user_id: feedback.userId,
    created_at: feedback.createdAt,
  };
}

function addReportJobAliases(job) {
  return {
    ...job,
    room_id: job.roomId,
    queued_at: job.queuedAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    latency_ms: job.latencyMs,
    queue_depth_at_enqueue: job.queueDepthAtEnqueue,
    report_id: job.reportId,
  };
}

function getRoomAgentIds(room) {
  return Array.isArray(room.selectedAgentIds) && room.selectedAgentIds.length
    ? room.selectedAgentIds
    : [];
}

function roomSummary(room) {
  const lastMessage = room.messages[room.messages.length - 1] || null;
  const latestReport = room.reports[room.reports.length - 1] || null;
  return {
    id: room.id,
    scenarioId: room.scenario.id,
    scenarioTitle: room.scenario.title,
    status: room.status,
    policyMode: room.policyMode,
    sessionNumber: room.sessionNumber,
    messages: room.messages.length,
    reports: room.reports.length,
    selectedAgentIds: room.selectedAgentIds,
    createdAt: room.createdAt,
    updatedAt:
      (latestReport && latestReport.createdAt) ||
      (lastMessage && lastMessage.createdAt) ||
      room.endedAt ||
      room.createdAt,
  };
}

function currentSystemContext() {
  return {
    activeRooms: [...rooms.values()].filter((room) => room.status === "active").length,
    roomsTracked: rooms.size,
  };
}

function enqueueReport(room, source, options = {}) {
  const job = {
    id: randomUUID(),
    roomId: room.id,
    source,
    status: "queued",
    queuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    latencyMs: null,
    queueDepthAtEnqueue: reportQueue.length + 1,
    reportId: null,
    error: null,
  };
  room.reportJobs.push(job);
  reportQueue.push(job);
  runReportWorker();

  if (!options.wait) return job;
  return waitForReportJob(job);
}

function runReportWorker() {
  if (reportWorkerRunning) return;
  reportWorkerRunning = true;

  setImmediate(async () => {
    while (reportQueue.length) {
      const job = reportQueue.shift();
      const room = rooms.get(job.roomId);
      if (!room) continue;

      const started = Date.now();
      job.status = "processing";
      job.startedAt = new Date().toISOString();
      broadcastRoom(room.id, "report_processing", reportJobEventPayload(room, job));
      await persistRoom(room);

      try {
        await delay(25);
        const systemContext = currentSystemContext();
        const draftReport =
          job.source === "session_feedback_refresh" && room.reports.length
            ? refreshLatestReport(room, { systemContext })
            : buildReport(room, { systemContext });
        const judgedReport = await llmProvider.judgeReport({
          room,
          draftReport,
          fallback: () => draftReport,
        });
        const report = replaceStoredReport(room, draftReport, judgedReport);
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        job.latencyMs = Date.now() - started;
        job.reportId = report.id;
        report.systemPerformance.reportGenerationLatencyMs = job.latencyMs;
        broadcastRoom(room.id, "report_ready", reportReadyEventPayload(room, report, job));
        await persistRoom(room);
        broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
      } catch (error) {
        job.status = "failed";
        job.completedAt = new Date().toISOString();
        job.latencyMs = Date.now() - started;
        job.error = error.message;
        broadcastRoom(room.id, "report_failed", reportJobEventPayload(room, job));
        await persistRoom(room);
        broadcastRoom(room.id, "state_snapshot", snapshot(room.id));
      }
    }

    reportWorkerRunning = false;
  });
}

function replaceStoredReport(room, draftReport, candidateReport) {
  const report =
    candidateReport && candidateReport.id === draftReport.id && candidateReport.roomId === draftReport.roomId
      ? candidateReport
      : draftReport;
  const index = room.reports.findIndex((candidate) => candidate.id === draftReport.id);
  if (index === -1) {
    room.reports.push(report);
    return report;
  }
  room.reports[index] = report;
  return report;
}

function waitForReportJob(job) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const room = rooms.get(job.roomId);
      const currentJob = room && room.reportJobs.find((candidate) => candidate.id === job.id);
      if (!currentJob) {
        clearInterval(timer);
        reject(new Error("Report job disappeared."));
        return;
      }
      if (currentJob.status === "completed") {
        clearInterval(timer);
        const report = room.reports.find((candidate) => candidate.id === currentJob.reportId);
        resolve(report);
        return;
      }
      if (currentJob.status === "failed") {
        clearInterval(timer);
        reject(new Error(currentJob.error || "Report job failed."));
        return;
      }
      if (Date.now() - started > 15000) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for report job."));
      }
    }, 20);
  });
}

function snapshot(roomId) {
  return serializeRoom(ensureRoom(roomId));
}

async function persistRoom(room) {
  try {
    await storage.saveRoom(room);
  } catch (error) {
    console.error(`Failed to persist room ${room.id}:`, error.message);
  }
}

function ensureRoom(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (!rooms.has(normalized)) rooms.set(normalized, createRoom(normalized));
  return rooms.get(normalized);
}

function uniqueRoomId(requested) {
  const base = normalizeRoomId(requested || `room-${randomUUID().slice(0, 8)}`);
  if (!rooms.has(base)) return base;

  for (let index = 2; index < 50; index += 1) {
    const candidate = `${base}-${index}`;
    if (!rooms.has(candidate)) return candidate;
  }

  return `room-${randomUUID().slice(0, 8)}`;
}

function normalizeRoomId(id) {
  const normalized = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.slice(0, 48) || "demo-room";
}

function roomIdFromPath(pathname) {
  if (!pathname.startsWith("/rooms/")) return null;
  return normalizeRoomId(pathname.replace("/rooms/", ""));
}

function broadcastRoom(roomId, type, payload) {
  const started = Date.now();
  const event = JSON.stringify({ type, ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client.roomId === roomId) {
      client.send(event);
    }
  });
  const room = rooms.get(roomId);
  if (room) recordRuntimeMetric(room, "fanoutLatenciesMs", Date.now() - started);
}

function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, ...payload }));
}

function chunkText(text) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let index = 0; index < words.length; index += 4) {
    chunks.push(words.slice(index, index + 4).join(" "));
  }
  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeneratedMessage(generated) {
  if (generated && typeof generated === "object") {
    return {
      content: String(generated.content || "").trim(),
      modelName: generated.modelName || null,
      promptVersion: generated.promptVersion || null,
    };
  }

  return {
    content: String(generated || "").trim(),
    modelName: null,
    promptVersion: null,
  };
}

function ensureRuntimeMetrics(room) {
  if (!room.runtimeMetrics) {
    room.runtimeMetrics = {
      websocketConnections: 0,
      websocketDisconnects: 0,
      fanoutLatenciesMs: [],
      feedbackWriteLatenciesMs: [],
      llmErrors: 0,
      timeouts: 0,
    };
  }
  return room.runtimeMetrics;
}

function recordRuntimeMetric(room, key, value) {
  const metrics = ensureRuntimeMetrics(room);
  if (!Array.isArray(metrics[key]) || !Number.isFinite(value)) return;
  metrics[key].push(value);
  if (metrics[key].length > 500) {
    metrics[key] = metrics[key].slice(-500);
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extension] || "application/octet-stream"
  );
}

async function bootstrap() {
  const loadedRooms = await storage.loadRooms();
  loadedRooms.forEach((room, roomId) => rooms.set(roomId, room));

  if (!rooms.has("demo-room")) {
    const demoRoom = createRoom("demo-room");
    rooms.set(demoRoom.id, demoRoom);
    await persistRoom(demoRoom);
  }

  server.listen(port, () => {
    console.log(`SocialRL Arena demo running at http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start SocialRL Arena:", error);
  process.exit(1);
});
