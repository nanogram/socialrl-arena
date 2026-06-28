const state = {
  connected: false,
  room: null,
  socket: null,
  setupKey: "",
  recentRooms: [],
  recentRoomsLoaded: false,
  displayName: localStorage.getItem("socialrl_display_name") || "Demo Reviewer",
  debugPanelVisible: localStorage.getItem("socialrl_debug_panel") !== "hidden",
  agentThinking: null,
};

const quickFeedbackOrder = [
  "helped_us_decide",
  "good_timing",
  "made_chat_fun",
  "good_read",
  "reduced_tension",
  "should_have_stayed_quiet",
  "interrupted_humans",
  "too_verbose",
  "wrong_vibe",
  "ignored_quiet_person",
];

const messagesEl = document.querySelector("#messages");
const decisionsEl = document.querySelector("#decisions");
const routingDecisionsEl = document.querySelector("#routingDecisions");
const reportEl = document.querySelector("#report");
const roomMetricsEl = document.querySelector("#roomMetrics");
const scenarioEl = document.querySelector("#scenario");
const connectionStatusEl = document.querySelector("#connectionStatus");
const roomStatusEl = document.querySelector("#roomStatus");
const policyModeEl = document.querySelector("#policyMode");
const sessionNumberEl = document.querySelector("#sessionNumber");
const debugToggleButton = document.querySelector("#debugToggleButton");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const speakerSelect = document.querySelector("#speakerSelect");
const displayNameInput = document.querySelector("#displayNameInput");
const scenarioSelect = document.querySelector("#scenarioSelect");
const roomNameInput = document.querySelector("#roomNameInput");
const agentTogglesEl = document.querySelector("#agentToggles");
const inviteLinkInput = document.querySelector("#inviteLink");
const participantsEl = document.querySelector("#participants");
const policiesEl = document.querySelector("#policies");
const sessionFeedbackForm = document.querySelector("#sessionFeedbackForm");
const mostUsefulAgent = document.querySelector("#mostUsefulAgent");
const mostAnnoyingAgent = document.querySelector("#mostAnnoyingAgent");
const routeNextAgent = document.querySelector("#routeNextAgent");
const didReachDecision = document.querySelector("#didReachDecision");
const wouldInviteAgain = document.querySelector("#wouldInviteAgain");
const humansTalked = document.querySelector("#humansTalked");
const sessionNotes = document.querySelector("#sessionNotes");

connect();
displayNameInput.value = state.displayName;

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content) return;

  send({
    type: "send_message",
    display_name: speakerSelect.value,
    content,
  });
  messageInput.value = "";
});

document.querySelector("#createRoomButton").addEventListener("click", () => {
  saveDisplayName();
  send({
    type: "create_room",
    room_id: roomNameInput.value,
    scenario_id: scenarioSelect.value,
    agent_ids: getSelectedAgentIds(),
    display_name: state.displayName,
  });
});

document.querySelector("#joinRoomButton").addEventListener("click", () => {
  saveDisplayName();
  send({
    type: "join_room",
    room_id: state.room ? state.room.id : getInitialRoomId(),
    display_name: state.displayName,
  });
});

document.querySelector("#configureRoomButton").addEventListener("click", () => {
  send({
    type: "configure_room",
    scenario_id: scenarioSelect.value,
    agent_ids: getSelectedAgentIds(),
  });
});

document.querySelector("#sampleButton").addEventListener("click", () => {
  send({ type: "run_sample_session" });
});

document.querySelector("#endButton").addEventListener("click", () => {
  send({ type: "end_session" });
});

document.querySelector("#improveButton").addEventListener("click", () => {
  send({ type: "apply_improved_policy" });
});

document.querySelector("#exportButton").addEventListener("click", () => {
  if (!state.room) return;
  window.location.href = `/api/rooms/${state.room.id}/export`;
});

document.querySelector("#chatPageButton").addEventListener("click", () => {
  if (!state.room) return;
  window.location.href = `/rooms/${state.room.id}`;
});

document.querySelector("#reportPageButton").addEventListener("click", () => {
  if (!state.room) return;
  window.location.href = `/rooms/${state.room.id}/report`;
});

document.querySelector("#shapePageButton").addEventListener("click", () => {
  if (!state.room) return;
  const latestReport = state.room.reports[state.room.reports.length - 1];
  const firstAgent = latestReport && latestReport.agents[0];
  const agentId = firstAgent ? firstAgent.agentId : state.room.selectedAgentIds[0];
  window.location.href = `/rooms/${state.room.id}/shapes/${agentId}`;
});

document.querySelector("#resetButton").addEventListener("click", () => {
  send({ type: "reset_demo" });
});

debugToggleButton.addEventListener("click", () => {
  state.debugPanelVisible = !state.debugPanelVisible;
  localStorage.setItem("socialrl_debug_panel", state.debugPanelVisible ? "visible" : "hidden");
  renderStatus();
});

sessionFeedbackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  send({
    type: "add_session_feedback",
    most_useful_agent_id: mostUsefulAgent.value || null,
    most_annoying_agent_id: mostAnnoyingAgent.value || null,
    route_next_agent_id: routeNextAgent.value || null,
    did_reach_decision: didReachDecision.checked,
    would_invite_again: wouldInviteAgain.checked,
    humans_talked_more_or_less: humansTalked.value,
    freeform_notes: sessionNotes.value,
  });
  sessionNotes.value = "";
});

inviteLinkInput.addEventListener("focus", () => {
  inviteLinkInput.select();
});

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const roomId = getInitialRoomId();
  const socket = new WebSocket(`${protocol}://${window.location.host}?room=${encodeURIComponent(roomId)}`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.connected = true;
    send({ type: "join_room", room_id: roomId, display_name: state.displayName });
    renderStatus();
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    renderStatus();
    window.setTimeout(connect, 900);
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state_snapshot") {
      state.room = message;
      syncUrl(message.id);
      refreshRoomIndex();
      render();
      return;
    }

    if (message.type === "room_created") {
      state.room = message.room;
      state.setupKey = "";
      syncUrl(message.room.id);
      refreshRoomIndex();
      render();
      return;
    }

    if (message.type === "error") {
      console.error(message.message);
      return;
    }

    if (!state.room) return;

    if (message.type === "agent_thinking") {
      state.agentThinking = message;
      renderDecisions();
      return;
    }

    if (message.type === "message_created") {
      upsertMessage(message.message);
      render();
      return;
    }

    if (message.type === "message_stream_delta") {
      updateStreamingMessage(message.messageId, message.content);
      renderPrimaryPanel();
      return;
    }

    if (message.type === "message_stream_done") {
      upsertMessage(message.message);
      render();
      return;
    }

    if (message.type === "agent_decision") {
      state.agentThinking = null;
      upsertById(state.room.decisions, message.decision);
      renderDecisions();
      renderRoutingDecisions();
      renderRoomMetrics();
      return;
    }

    if (message.type === "feedback_added") {
      applyFeedback(message.feedback);
      render();
      return;
    }

    if (message.type === "session_feedback_added") {
      upsertById(state.room.sessionFeedback, message.feedback);
      renderReport();
      return;
    }

    if (message.type === "report_queued" || message.type === "report_processing") {
      upsertById(state.room.reportJobs, message.job);
      renderRoomMetrics();
      return;
    }

    if (message.type === "report_ready") {
      if (message.job) upsertById(state.room.reportJobs, message.job);
      upsertById(state.room.reports, message.report);
      state.room.status = "ended";
      render();
      return;
    }

    if (message.type === "report_failed") {
      upsertById(state.room.reportJobs, message.job);
      renderRoomMetrics();
      return;
    }

  });
}

function send(event) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(event));
}

function upsertMessage(message) {
  if (!message) return;
  upsertById(state.room.messages, message);
}

function updateStreamingMessage(messageId, content) {
  const message = state.room.messages.find((candidate) => candidate.id === messageId);
  if (!message) return;
  message.content = content;
  message.streaming = true;
}

function applyFeedback(feedback) {
  if (!feedback) return;
  upsertById(state.room.feedback, feedback);
  const message = state.room.messages.find((candidate) => candidate.id === feedback.messageId);
  if (message) upsertById(message.feedback, feedback);
}

function upsertById(collection, item) {
  if (!collection || !item || !item.id) return;
  const index = collection.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) {
    collection.push(item);
    return;
  }
  collection[index] = { ...collection[index], ...item };
}

function render() {
  renderStatus();
  renderSetup();
  renderPrimaryPanel();
  renderParticipants();
  renderPolicies();
  renderDecisions();
  renderRoutingDecisions();
  renderRoomMetrics();
  renderReport();
}

function renderStatus() {
  connectionStatusEl.textContent = state.connected ? "Connected" : "Disconnected";
  if (!state.room) return;
  scenarioEl.textContent = state.room.scenario.title;
  roomStatusEl.textContent = state.room.id;
  policyModeEl.textContent =
    state.room.policyMode === "improved" ? "Improved Policy" : "Baseline Policy";
  sessionNumberEl.textContent = `Run ${state.room.sessionNumber}`;
  document.body.dataset.view = getViewMode().type;
  document.body.dataset.debugPanel = state.debugPanelVisible ? "visible" : "hidden";
  debugToggleButton.textContent = state.debugPanelVisible ? "Normal Chat" : "Debug View";
}

function renderSetup() {
  const room = state.room;
  if (!room) return;

  const setupKey = `${room.id}:${room.scenario.id}:${room.selectedAgentIds.join(",")}:${room.availableAgents.length}`;
  if (setupKey === state.setupKey) {
    inviteLinkInput.value = `${window.location.origin}/rooms/${room.id}`;
    renderSpeakerSelect(room);
    return;
  }
  state.setupKey = setupKey;

  displayNameInput.value = state.displayName;
  roomNameInput.value = room.id;
  inviteLinkInput.value = `${window.location.origin}/rooms/${room.id}`;
  scenarioSelect.innerHTML = room.scenarios
    .map((scenario) => {
      const selected = scenario.id === room.scenario.id ? "selected" : "";
      return `<option value="${scenario.id}" ${selected}>${escapeHtml(scenario.title)}</option>`;
    })
    .join("");

  agentTogglesEl.innerHTML = room.availableAgents
    .map((agent) => {
      const checked = room.selectedAgentIds.includes(agent.id) ? "checked" : "";
      return `
        <label class="agent-toggle">
          <input type="checkbox" value="${agent.id}" ${checked} />
          <span>
            <strong>${escapeHtml(agent.name)}</strong>
            <small>${escapeHtml(agent.role)}</small>
          </span>
        </label>
      `;
    })
    .join("");

  renderAgentSelect(mostUsefulAgent, room.agents);
  renderAgentSelect(mostAnnoyingAgent, room.agents);
  renderAgentSelect(routeNextAgent, room.agents);
  renderSpeakerSelect(room);
}

function renderSpeakerSelect(room) {
  const current = speakerSelect.value || state.displayName;
  const names = [
    state.displayName,
    ...room.participants.map((participant) => participant.displayName),
    ...room.scenario.sampleScript.map(([speaker]) => speaker),
  ];
  const uniqueNames = [...new Set(names.filter(Boolean))];
  speakerSelect.innerHTML = uniqueNames
    .map((name) => {
      const selected = current === name ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function renderAgentSelect(select, agents) {
  const current = select.value;
  select.innerHTML =
    `<option value="">None</option>` +
    agents
      .map((agent) => {
        const selected = current === agent.id ? "selected" : "";
        return `<option value="${agent.id}" ${selected}>${escapeHtml(agent.name)}</option>`;
      })
      .join("");
}

function renderPrimaryPanel() {
  const view = getViewMode();
  messageForm.hidden = view.type !== "chat";

  if (view.type === "create") {
    renderCreatePage();
    return;
  }

  if (view.type === "report") {
    renderReportPage();
    return;
  }

  if (view.type === "shape") {
    renderShapePage(view.agentId);
    return;
  }

  renderMessages();
}

function renderCreatePage() {
  const room = state.room;
  if (!room) {
    messagesEl.innerHTML = `<div class="empty-state">Loading rooms.</div>`;
    return;
  }

  messagesEl.innerHTML = `
    <section class="full-report">
      <article class="report-card">
        <div class="report-title">
          <strong>Create A Room</strong>
          <span class="status-pill">${escapeHtml(room.scenario.title)}</span>
        </div>
        <p>Choose a scenario and agent set in Room Setup, then create a room. Reopen recent rooms below for live chat, reports, or Shape reviews.</p>
        <div class="metric-grid">
          ${metric("Scenarios", room.scenarios.length)}
          ${metric("Agents", room.availableAgents.length)}
          ${metric("Recent rooms", state.recentRooms.length)}
          ${metric("Storage", "local")}
        </div>
      </article>
      <article class="report-card">
        <div class="report-title">
          <strong>Recent Rooms</strong>
          <button type="button" class="quiet inline-button" id="refreshRoomsButton">Refresh</button>
        </div>
        <div class="room-list">
          ${renderRecentRooms()}
        </div>
      </article>
    </section>
  `;

  const refreshButton = messagesEl.querySelector("#refreshRoomsButton");
  if (refreshButton) refreshButton.addEventListener("click", refreshRoomIndex);
}

function renderRecentRooms() {
  if (!state.recentRoomsLoaded) {
    return `<p>Loading recent rooms.</p>`;
  }

  if (!state.recentRooms.length) {
    return `<p>No rooms yet.</p>`;
  }

  return state.recentRooms
    .slice(0, 12)
    .map((room) => {
      return `
        <div class="room-list-item">
          <div>
            <strong>${escapeHtml(room.id)}</strong>
            <span>${escapeHtml(room.scenarioTitle)} · ${escapeHtml(room.status)} · ${room.messages} messages</span>
          </div>
          <div class="room-actions">
            <a href="/rooms/${room.id}">Chat</a>
            <a href="/rooms/${room.id}/report">Report</a>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderMessages() {
  const room = state.room;
  if (!room || !room.messages.length) {
    messagesEl.innerHTML = `<div class="empty-state">Start the room or run the sample session.</div>`;
    return;
  }

  messagesEl.innerHTML = room.messages.map(renderMessage).join("");
  messagesEl.querySelectorAll("[data-feedback-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      send({
        type: "add_feedback",
        message_id: button.dataset.messageId,
        tag: button.dataset.feedbackTag,
      });
    });
  });
  messagesEl.querySelectorAll("[data-feedback-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".feedback-select-row");
      const select = row && row.querySelector("[data-feedback-select]");
      if (!select || !select.value) return;
      send({
        type: "add_feedback",
        message_id: button.dataset.messageId,
        tag: select.value,
      });
      select.value = "";
    });
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderReportPage() {
  const room = state.room;
  const report = room && room.reports[room.reports.length - 1];
  if (!report) {
    messagesEl.innerHTML = `<div class="empty-state">No report yet. Run a session, then end it.</div>`;
    return;
  }

  messagesEl.innerHTML = `
    <section class="full-report">
      <article class="report-card">
        <div class="report-title">
          <strong>${escapeHtml(report.scenarioTitle)}</strong>
          <span class="status-pill">${escapeHtml(report.policyMode)} · Run ${report.sessionNumber}</span>
        </div>
        <p>${escapeHtml(report.summary)}</p>
        <div class="metric-grid">
          ${metric("Messages", report.roomStats.totalMessages)}
          ${metric("Human", report.roomStats.humanMessages)}
          ${metric("AI", report.roomStats.aiMessages)}
          ${metric("Routes", report.roomStats.routingDecisions)}
          ${metric("Report ms", report.systemPerformance.reportGenerationLatencyMs)}
          ${metric("P99 fanout", report.systemPerformance.p99FanoutLatencyMs)}
          ${metric("P99 response", report.systemPerformance.p99FullResponseLatencyMs)}
          ${metric("Queue max", report.systemPerformance.maxReportQueueDepth)}
          ${metric("Feedback", report.roomStats.feedbackTags)}
        </div>
      </article>
      ${report.agents.map(renderExpandedAgentReport).join("")}
      ${renderComparison(report)}
    </section>
  `;
}

function renderShapePage(agentId) {
  const room = state.room;
  const report = room && room.reports[room.reports.length - 1];
  const shape = report && report.agents.find((agentReport) => agentReport.agentId === agentId);

  if (!shape) {
    messagesEl.innerHTML = `<div class="empty-state">No Shape report found for this agent yet.</div>`;
    return;
  }

  messagesEl.innerHTML = `
    <section class="full-report">
      <article class="report-card">
        <div class="report-title">
          <strong>${escapeHtml(shape.agentName)}</strong>
          <span class="status-pill">${escapeHtml(shape.role)}</span>
        </div>
        <p>${escapeHtml(shape.summary)}</p>
        <div class="metric-grid">
          ${Object.entries(shape.scorecard)
            .map(([label, value]) => metric(formatTag(label), value))
            .join("")}
        </div>
      </article>
      <article class="report-card">
        <div class="report-title"><strong>Policy Diff</strong></div>
        <p><strong>Before:</strong> ${escapeHtml(shape.policyDiff.before)}</p>
        <p><strong>After:</strong> ${escapeHtml(shape.policyDiff.after)}</p>
        <p>${escapeHtml(shape.policyDiff.rationale)}</p>
      </article>
      <article class="report-card">
        <div class="report-title"><strong>Routing Recommendation</strong></div>
        <p>${escapeHtml(shape.routingRecommendation.reason)}</p>
        <div class="tag-list">
          ${shape.routingRecommendation.recommendedFor.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
        ${renderRoutingScores(shape.routingScores)}
      </article>
      ${renderMessageExamples("Best Messages", shape.bestMessages)}
      ${renderMessageExamples("Worst Messages", shape.worstMessages)}
    </section>
  `;
}

function renderMessage(message) {
  const initials = initialsFor(message.senderName);
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const aiClass = message.agentId || "";
  const version =
    message.senderType === "ai"
      ? `<span>${escapeHtml(message.modelName || "model")} · ${escapeHtml(message.promptVersion || "prompt")} · ${escapeHtml(message.policyVersion || "policy")}</span>`
      : `<span>${time}</span>`;
  const feedback =
    message.senderType === "ai" && !message.streaming
      ? renderFeedbackControls(message)
      : "";

  return `
    <article class="message-row ${message.senderType}">
      <div class="avatar">${escapeHtml(initials)}</div>
      <div class="message ${message.senderType} ${aiClass}">
        <div class="message-header">
          <span class="sender">${escapeHtml(message.senderName)}</span>
          ${version}
        </div>
        <p class="${message.streaming ? "streaming" : ""}">${escapeHtml(message.content || " ")}</p>
        ${feedback}
      </div>
    </article>
  `;
}

function renderFeedbackControls(message) {
  return `
    <div class="feedback-controls">
      <div class="feedback-bar">${quickFeedbackOrder.map((tag) => renderFeedbackButton(message, tag)).join("")}</div>
      <div class="feedback-select-row">
        <select data-feedback-select="${message.id}" aria-label="Feedback tag">
          <option value="">More feedback</option>
          ${renderFeedbackOptions()}
        </select>
        <button type="button" data-feedback-add data-message-id="${message.id}">Add</button>
      </div>
    </div>
  `;
}

function renderFeedbackButton(message, tag) {
  const definition = state.room.feedbackDefinitions[tag];
  if (!definition) return "";
  const count = message.feedback.filter((entry) => entry.tag === tag).length;
  return `
    <button
      type="button"
      class="${count ? "selected" : ""}"
      data-message-id="${message.id}"
      data-feedback-tag="${tag}"
      title="${escapeHtml(definition.category)}"
    >
      ${escapeHtml(definition.label)}${count ? ` ${count}` : ""}
    </button>
  `;
}

function renderFeedbackOptions() {
  return Object.entries(groupFeedbackDefinitions())
    .map(([category, definitions]) => {
      const options = definitions
        .map(
          ([tag, definition]) =>
            `<option value="${tag}">${escapeHtml(definition.label)}</option>`,
        )
        .join("");
      return `<optgroup label="${escapeHtml(formatTag(category))}">${options}</optgroup>`;
    })
    .join("");
}

function groupFeedbackDefinitions() {
  return Object.entries(state.room.feedbackDefinitions).reduce((groups, entry) => {
    const category = entry[1].category || "other";
    if (!groups[category]) groups[category] = [];
    groups[category].push(entry);
    return groups;
  }, {});
}

function renderDecisions() {
  const room = state.room;
  if (!room || !room.decisions.length) {
    decisionsEl.innerHTML = state.agentThinking
      ? renderThinkingState()
      : `<div class="empty-state">No agent decisions yet.</div>`;
    return;
  }

  decisionsEl.innerHTML =
    (state.agentThinking ? renderThinkingState() : "") +
    [...room.decisions]
    .slice(-12)
    .reverse()
    .map((decision) => {
      const route = decision.route ? decision.route.reason : "No route metadata";
      const routerModel = decision.route && decision.route.routerModelName ? decision.route.routerModelName : "router";
      return `
        <article class="decision">
          <div class="decision-top">
            <span class="decision-name">${escapeHtml(decision.agentName)}</span>
            <span class="badge ${decision.decision}">${formatDecision(decision.decision)}</span>
          </div>
          <div class="decision-meta">
            ${Math.round(decision.confidence * 100)}% confidence · ${escapeHtml(decision.groupState)} · ${escapeHtml(decision.roomType)}
            <br />
            ${escapeHtml(decision.modelName || "model")} · ${escapeHtml(decision.promptVersion || "prompt")} · ${escapeHtml(decision.policyVersion || "policy")}
            <br />
            Router ${escapeHtml(routerModel)}
            <br />
            ${escapeHtml(decision.reason)}
            <br />
            ${escapeHtml(route)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRoutingDecisions() {
  const room = state.room;
  if (!room || !room.routingDecisions.length) {
    routingDecisionsEl.innerHTML = `<div class="empty-state">No router decisions yet.</div>`;
    return;
  }

  routingDecisionsEl.innerHTML = [...room.routingDecisions]
    .slice(-6)
    .reverse()
    .map((route) => {
      const selected = route.selectedAgentName || route.selectedAgentId || "No agent";
      const blocked = route.blockedAgentIds && route.blockedAgentIds.length
        ? route.blockedAgentIds.join(", ")
        : "None";
      return `
        <article class="decision route-decision">
          <div class="decision-top">
            <span class="decision-name">${escapeHtml(selected)}</span>
            <span class="badge ${route.selectedAgentId ? "speak" : "stay_silent"}">${route.selectedAgentId ? "selected" : "none"}</span>
          </div>
          <div class="decision-meta">
            ${escapeHtml(route.roomType || "room")} · ${escapeHtml(route.groupState || "active")}
            <br />
            ${escapeHtml(route.routerModelName || "router")} · ${escapeHtml(route.routerVersion || "router")}
            <br />
            ${escapeHtml(route.reason || "No routing reason recorded.")}
            <br />
            Blocked: ${escapeHtml(blocked)}
          </div>
          ${renderCandidateScores(route.candidateScores)}
        </article>
      `;
    })
    .join("");
}

function renderCandidateScores(candidateScores) {
  if (!Array.isArray(candidateScores) || !candidateScores.length) return "";

  return `
    <div class="candidate-list">
      ${candidateScores
        .map(
          (candidate) => `
            <div class="candidate-row">
              <span>${escapeHtml(candidate.agentName || candidate.agentId)}</span>
              <strong>${Math.round((candidate.confidence || 0) * 100)}%</strong>
              <small>${escapeHtml(formatDecision(candidate.decision || "wait"))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderThinkingState() {
  return `
    <article class="decision thinking">
      <div class="decision-top">
        <span class="decision-name">Agent Orchestrator</span>
        <span class="badge wait">thinking</span>
      </div>
      <div class="decision-meta">
        ${escapeHtml(formatTag(state.agentThinking.state || "deciding"))}
        ${state.agentThinking.triggerMessageId ? `<br />Trigger ${escapeHtml(state.agentThinking.triggerMessageId)}` : ""}
      </div>
    </article>
  `;
}

function renderParticipants() {
  const room = state.room;
  if (!room || (!room.participants.length && !room.agents.length)) {
    participantsEl.innerHTML = `<div class="empty-state">No active participants.</div>`;
    return;
  }

  const humans = room.participants.map((participant) => ({
    id: participant.id,
    name: participant.displayName,
    type: "Human",
    detail: "Connected now",
    className: "human",
  }));
  const shapes = room.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    type: "AI Shape",
    detail: agent.role,
    className: agent.id,
  }));

  participantsEl.innerHTML = [...humans, ...shapes]
    .map(
      (participant) => `
        <div class="participant ${escapeHtml(participant.className)}">
          <span class="avatar mini">${escapeHtml(initialsFor(participant.name))}</span>
          <div>
            <strong>${escapeHtml(participant.name)}</strong>
            <small>${escapeHtml(participant.type)} · ${escapeHtml(participant.detail)}</small>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderPolicies() {
  const room = state.room;
  if (!room || !room.agents.length) {
    policiesEl.innerHTML = `<div class="empty-state">No agents selected.</div>`;
    return;
  }

  policiesEl.innerHTML = room.agents
    .map((agent) => {
      const policy =
        room.policyMode === "improved"
          ? (room.activePolicyOverrides && room.activePolicyOverrides[agent.id]) || agent.improvedPolicy
          : agent.baselinePolicy;
      const policyVersion =
        room.policyMode === "improved"
          ? agent.policyVersion.replace("baseline", "improved")
          : agent.policyVersion;
      return `
        <article class="policy-item">
          <div>
            <strong>${escapeHtml(agent.name)}</strong>
            <small>${escapeHtml(agent.modelName)} · ${escapeHtml(agent.promptVersion)} · ${escapeHtml(policyVersion)}</small>
          </div>
          <p><strong>Personality:</strong> ${escapeHtml(agent.basePersonality)}</p>
          <p>${escapeHtml(policy)}</p>
          <div class="tag-list">
            ${agent.routingFit.map((fit) => `<span class="tag">${escapeHtml(fit)}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRoomMetrics() {
  const room = state.room;
  if (!room) {
    roomMetricsEl.innerHTML = "";
    return;
  }

  const latestReport = room.reports[room.reports.length - 1];
  const stats =
    latestReport && latestReport.roomStats
      ? latestReport.roomStats
      : {
          totalMessages: room.messages.length,
          humanMessages: room.messages.filter((message) => message.senderType === "human").length,
          aiMessages: room.messages.filter((message) => message.senderType === "ai").length,
          feedbackTags: room.feedback.length,
          routingDecisions: room.routingDecisions.length,
          groupState: room.currentGroupState,
        };

  roomMetricsEl.innerHTML = `
    <article class="report-card">
      <div class="metric-grid">
        ${metric("Messages", stats.totalMessages)}
        ${metric("Human", stats.humanMessages)}
        ${metric("AI", stats.aiMessages)}
        ${metric("Feedback", stats.feedbackTags)}
        ${metric("Routes", stats.routingDecisions || room.routingDecisions.length)}
      </div>
      <p><strong>State:</strong> ${escapeHtml(stats.groupState || room.currentGroupState)}</p>
      <p><strong>Router:</strong> ${escapeHtml(room.routerVersion)} · <strong>Policy:</strong> ${escapeHtml(room.currentPolicyVersion)}</p>
    </article>
  `;
}

function renderReport() {
  const room = state.room;
  if (!room || !room.reports.length) {
    reportEl.innerHTML = `<div class="empty-state">End the session to generate a report.</div>`;
    return;
  }

  const report = room.reports[room.reports.length - 1];
  reportEl.innerHTML = `
    <article class="report-card">
      <div class="report-title">
        <strong>${report.policyMode === "improved" ? "Improved" : "Baseline"} run</strong>
        <span class="status-pill">Run ${report.sessionNumber}</span>
      </div>
      <p>${escapeHtml(report.summary)}</p>
      ${renderSessionFeedback(report.sessionFeedbackSummary)}
    </article>
    ${report.agents.map(renderAgentReport).join("")}
    ${renderComparison(report)}
  `;
}

function renderSessionFeedback(summary) {
  if (!summary || !summary.totalResponses) {
    return `<p>No session-level feedback submitted yet.</p>`;
  }

  return `
    <div class="metric-grid">
      ${metric("Session feedback", summary.totalResponses)}
      ${metric("Reached decision", `${Math.round(summary.didReachDecisionRate * 100)}%`)}
      ${metric("Invite again", `${Math.round(summary.wouldInviteAgainRate * 100)}%`)}
      ${metric("Talked more", summary.humansTalkedMoreOrLess.more || 0)}
      ${metric("Route votes", sumObjectValues(summary.routeNextAgentCounts))}
    </div>
  `;
}

function renderAgentReport(agentReport) {
  const tags = Object.entries(agentReport.stats.feedbackTagCounts)
    .map(([tag, count]) => `<span class="tag">${formatTag(tag)} ${count}</span>`)
    .join("");
  const failures = agentReport.failureModes
    .map((mode) => `<span class="tag">${escapeHtml(mode)}</span>`)
    .join("");

  return `
    <article class="report-card">
      <div class="report-title">
        <strong>${escapeHtml(agentReport.agentName)}</strong>
        <span class="status-pill">${escapeHtml(agentReport.role)}</span>
      </div>
      <p>${escapeHtml(agentReport.summary)}</p>
      <div class="metric-grid">
        ${metric("Messages", agentReport.stats.totalMessages)}
        ${metric("Timing", agentReport.scorecard.timing)}
        ${metric("Restraint", agentReport.scorecard.restraint)}
        ${metric("Decision", agentReport.scorecard.decisionImpact)}
        ${metric("Human reply", `${Math.round(agentReport.stats.humanReplyRate * 100)}%`)}
        ${metric("Selected", agentReport.stats.routingSelectedCount)}
        ${metric("Msg/min", agentReport.stats.averageMessagesPerMinute)}
        ${metric("Route success", `${Math.round(agentReport.stats.routingSuccessRate * 100)}%`)}
      </div>
      <p><strong>Policy after:</strong> ${escapeHtml(agentReport.policyDiff.after)}</p>
      <p><strong>Route:</strong> ${escapeHtml(agentReport.routingRecommendation.reason)}</p>
      <div class="tag-list">${tags || `<span class="tag">No feedback</span>`}</div>
      <div class="tag-list">${failures}</div>
    </article>
  `;
}

function renderExpandedAgentReport(agentReport) {
  return `
    ${renderAgentReport(agentReport)}
    <article class="report-card">
      <div class="report-title">
        <strong>${escapeHtml(agentReport.agentName)} Details</strong>
        <a href="/rooms/${state.room.id}/shapes/${agentReport.agentId}">Shape review</a>
      </div>
      <p><strong>Failure modes:</strong> ${agentReport.failureModes.map(escapeHtml).join(", ")}</p>
      <p><strong>Policy rationale:</strong> ${escapeHtml(agentReport.policyDiff.rationale)}</p>
      ${renderRoutingScores(agentReport.routingScores)}
    </article>
  `;
}

function renderRoutingScores(scores) {
  if (!scores) return "";
  const entries = Object.entries(scores).filter(([key]) => key !== "agentId");
  if (!entries.length) return "";
  return `
    <div class="tag-list">
      ${entries
        .map(([key, value]) => `<span class="tag">${formatTag(key)} ${Math.round(Number(value) * 100)}%</span>`)
        .join("")}
    </div>
  `;
}

function renderMessageExamples(title, examples) {
  if (!examples || !examples.length) {
    return `
      <article class="report-card">
        <div class="report-title"><strong>${escapeHtml(title)}</strong></div>
        <p>No examples captured yet.</p>
      </article>
    `;
  }

  return `
    <article class="report-card">
      <div class="report-title"><strong>${escapeHtml(title)}</strong></div>
      ${examples
        .map(
          (example) => `
            <p><strong>${escapeHtml(example.feedbackTags.join(", "))}</strong></p>
            <p>${escapeHtml(example.text)}</p>
            <p>${escapeHtml(example.why)}</p>
            ${
              example.whatShouldHaveDoneInstead
                ? `<p><strong>Instead:</strong> ${escapeHtml(example.whatShouldHaveDoneInstead)}</p>`
                : ""
            }
          `,
        )
        .join("")}
    </article>
  `;
}

function renderComparison(report) {
  if (!report.comparison || !report.comparison.length) return "";

  return `
    <article class="report-card">
      <div class="report-title"><strong>Before / After</strong></div>
      ${report.comparison
        .map((item) => {
          const baseline = item.baseline || {};
          const improved = item.improved || {};
          return `
            <div class="comparison-block">
              <div class="metric-row">
                <span>${escapeHtml(item.agentName)}</span>
                <span>
                  messages ${signed(item.messageDelta)},
                  timing ${signed(item.timingScoreDelta)},
                  restraint ${signed(item.restraintScoreDelta)}
                </span>
              </div>
              <div class="comparison-grid">
                ${comparisonColumn("Baseline", baseline)}
                ${comparisonColumn("Improved", improved)}
              </div>
            </div>
          `;
        })
        .join("")}
    </article>
  `;
}

function comparisonColumn(title, values) {
  return `
    <div class="comparison-column">
      <strong>${escapeHtml(title)}</strong>
      <span>${Number(values.totalMessages || 0)} AI messages</span>
      <span>${Number(values.shouldHaveStayedQuietTags || 0)} stay-quiet tags</span>
      <span>${Number(values.tooVerboseTags || 0)} verbose tags</span>
      <span>${Number(values.helpedDecideTags || 0)} helped-decide tags</span>
      <span>Timing ${escapeHtml(String(values.timingScore || 0))} · Restraint ${escapeHtml(String(values.restraintScore || 0))}</span>
    </div>
  `;
}

function getSelectedAgentIds() {
  return [...agentTogglesEl.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function saveDisplayName() {
  state.displayName = displayNameInput.value.trim().slice(0, 28) || "Demo Reviewer";
  displayNameInput.value = state.displayName;
  localStorage.setItem("socialrl_display_name", state.displayName);
  if (state.room) renderSpeakerSelect(state.room);
}

function getInitialRoomId() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("room")) return params.get("room");
  if (window.location.pathname.startsWith("/rooms/")) {
    return window.location.pathname.split("/")[2] || "demo-room";
  }
  return "demo-room";
}

function syncUrl(roomId) {
  const view = getViewMode();
  if (view.type === "create") return;
  const nextPath = `/rooms/${roomId}`;
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const isRoomSubpage =
    pathParts[0] === "rooms" &&
    pathParts[1] === roomId &&
    (pathParts[2] === "report" || pathParts[2] === "shapes");
  if (!isRoomSubpage && window.location.pathname !== nextPath) {
    window.history.replaceState(null, "", nextPath);
  }
}

function getViewMode() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts[0] === "create") {
    return { type: "create" };
  }
  if (parts[0] === "rooms" && parts[2] === "report") {
    return { type: "report" };
  }
  if (parts[0] === "rooms" && parts[2] === "shapes") {
    return { type: "shape", agentId: parts[3] };
  }
  return { type: "chat" };
}

async function refreshRoomIndex() {
  if (state.recentRoomsRequestInFlight) return;
  state.recentRoomsRequestInFlight = true;
  try {
    const response = await fetch("/api/rooms");
    const body = await response.json();
    state.recentRooms = Array.isArray(body.rooms) ? body.rooms : [];
    state.recentRoomsLoaded = true;
    if (getViewMode().type === "create") renderCreatePage();
  } catch (error) {
    console.error(error);
  } finally {
    state.recentRoomsRequestInFlight = false;
  }
}

function metric(label, value) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function formatDecision(decision) {
  return decision.replace("_", " ");
}

function formatTag(tag) {
  return tag
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function signed(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function sumObjectValues(values) {
  return Object.values(values || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function initialsFor(name) {
  return String(name || "Human")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
