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
  replyTargetId: null,
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

const maxNormalParticipants = 6;

const messagesEl = document.querySelector("#messages");
const normalChatBarEl = document.querySelector("#normalChatBar");
const normalSessionFeedbackEl = document.querySelector("#normalSessionFeedback");
const replyPreviewEl = document.querySelector("#replyPreview");
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
    reply_to_message_id: state.replyTargetId,
  });
  messageInput.value = "";
  clearReplyTarget();
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
  renderNormalChatBar();
  renderNormalSessionFeedback();
  renderReplyPreview();
  renderPrimaryPanel();
  renderParticipants();
  renderPolicies();
  renderDecisions();
  renderRoutingDecisions();
  renderRoomMetrics();
  renderReport();
}

function renderNormalChatBar() {
  const room = state.room;
  if (!room) {
    normalChatBarEl.innerHTML = "";
    return;
  }

  const participants = [
    ...room.participants.map((participant) => ({
      name: participant.displayName,
      type: "Human",
    })),
    ...room.agents.map((agent) => ({
      name: agent.name,
      type: "AI",
    })),
  ];
  const visibleParticipants = participants.slice(0, maxNormalParticipants);
  const overflow = Math.max(0, participants.length - visibleParticipants.length);
  const latestReport = room.reports[room.reports.length - 1] || null;

  normalChatBarEl.innerHTML = `
    <div class="normal-participants" aria-label="Active participants">
      ${visibleParticipants
        .map(
          (participant) => `
            <span class="normal-participant">
              <span class="avatar mini">${escapeHtml(initialsFor(participant.name))}</span>
              <span>${escapeHtml(participant.name)}</span>
              <small>${escapeHtml(participant.type)}</small>
            </span>
          `,
        )
        .join("")}
      ${overflow ? `<span class="normal-participant more">+${overflow}</span>` : ""}
    </div>
    <div class="normal-actions">
      <button type="button" class="quiet compact-button" data-normal-action="invite">Invite</button>
      <button type="button" class="compact-button" data-normal-action="end">End + Report</button>
      ${
        latestReport
          ? `<button type="button" class="quiet compact-button" data-normal-action="report">Report</button>`
          : ""
      }
    </div>
  `;

  normalChatBarEl.querySelectorAll("[data-normal-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.normalAction === "invite") {
        copyInviteLink();
        return;
      }
      if (button.dataset.normalAction === "end") {
        send({ type: "end_session" });
        return;
      }
      if (button.dataset.normalAction === "report" && state.room) {
        window.location.href = `/rooms/${state.room.id}/report`;
      }
    });
  });
}

function copyInviteLink() {
  if (!state.room) return;
  const inviteUrl = `${window.location.origin}/rooms/${state.room.id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
  }
  inviteLinkInput.value = inviteUrl;
  inviteLinkInput.select();
}

function renderNormalSessionFeedback() {
  const room = state.room;
  if (!room || getViewMode().type !== "chat" || room.status !== "ended") {
    normalSessionFeedbackEl.innerHTML = "";
    return;
  }

  const responseCount = room.sessionFeedback.length;
  normalSessionFeedbackEl.innerHTML = `
    <form class="normal-feedback-card" data-normal-session-feedback-form>
      <div>
        <strong>Session Feedback</strong>
        <span>${responseCount} submitted</span>
      </div>
      <div class="normal-feedback-grid">
        <label>
          <span>Most useful</span>
          <select name="mostUsefulAgentId">${normalAgentOptions(room.agents)}</select>
        </label>
        <label>
          <span>Most annoying</span>
          <select name="mostAnnoyingAgentId">${normalAgentOptions(room.agents)}</select>
        </label>
        <label>
          <span>Route next</span>
          <select name="routeNextAgentId">${normalAgentOptions(room.agents)}</select>
        </label>
        <label>
          <span>Humans talked</span>
          <select name="humansTalkedMoreOrLess">
            <option value="more">More</option>
            <option value="same">Same</option>
            <option value="less">Less</option>
            <option value="unsure">Unsure</option>
          </select>
        </label>
      </div>
      <div class="check-row normal-check-row">
        <label><input name="didReachDecision" type="checkbox" /> Reached decision</label>
        <label><input name="wouldInviteAgain" type="checkbox" /> Would invite again</label>
      </div>
      <textarea name="freeformNotes" rows="2" placeholder="Notes for the report"></textarea>
      <button type="submit">Submit Feedback</button>
    </form>
  `;

  const form = normalSessionFeedbackEl.querySelector("[data-normal-session-feedback-form]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send({
      type: "add_session_feedback",
      most_useful_agent_id: form.elements.mostUsefulAgentId.value || null,
      most_annoying_agent_id: form.elements.mostAnnoyingAgentId.value || null,
      route_next_agent_id: form.elements.routeNextAgentId.value || null,
      did_reach_decision: form.elements.didReachDecision.checked,
      would_invite_again: form.elements.wouldInviteAgain.checked,
      humans_talked_more_or_less: form.elements.humansTalkedMoreOrLess.value,
      freeform_notes: form.elements.freeformNotes.value,
    });
    form.elements.freeformNotes.value = "";
  });
}

function normalAgentOptions(agents) {
  return (
    `<option value="">None</option>` +
    agents
      .map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`)
      .join("")
  );
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

  const rules = getAgentSelectionRules();
  const setupKey = `${room.id}:${room.scenario.id}:${room.selectedAgentIds.join(",")}:${room.availableAgents.length}:${rules.min}:${rules.max}`;
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
  syncAgentToggleConstraints();
  agentTogglesEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => syncAgentToggleConstraints(input));
  });

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

  if (view.type === "landing") {
    renderLandingPage();
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

function renderLandingPage() {
  const room = state.room;
  const latestRoom = state.recentRooms.find((candidate) => candidate.reports > 0) || state.recentRooms[0];
  const demoHref = latestRoom ? `/rooms/${latestRoom.id}` : "/rooms/demo-room";

  messagesEl.innerHTML = `
    <section class="landing-page">
      <section class="landing-hero" aria-label="SocialRL Arena landing">
        <div class="landing-copy">
          <span class="landing-eyebrow">Realtime multi-agent eval</span>
          <h2>SocialRL Arena</h2>
          <p>${escapeHtml(
            "Evaluate whether AI agents should speak, how they affect group dynamics, and which Shape should be routed into the next conversation.",
          )}</p>
          <div class="landing-actions">
            <a class="button-link primary" href="/create">Create Room</a>
            <a class="button-link" href="${demoHref}">Open Demo</a>
          </div>
        </div>
        <div class="landing-product" aria-hidden="true">
          <div class="landing-chat-window">
            <div class="landing-window-top">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div class="landing-message human">Alex: cheap but still fun</div>
            <div class="landing-route-row">
              <span class="landing-agent mediator">Mediator</span>
              <span class="landing-decision">speak · 84%</span>
              <span class="landing-chip">selected</span>
            </div>
            <div class="landing-route-row muted">
              <span class="landing-agent vibe">Vibe Friend</span>
              <span class="landing-decision">wait · 61%</span>
              <span class="landing-chip">blocked</span>
            </div>
            <div class="landing-message ai">Mediator: Want to pick the constraint first?</div>
            <div class="landing-feedback">
              <span>helped us decide</span>
              <span>good timing</span>
              <span>route next</span>
            </div>
          </div>
          <div class="landing-report-window">
            <strong>Shape Report</strong>
            <div class="landing-score-grid">
              <span>Timing <b>4</b></span>
              <span>Restraint <b>5</b></span>
              <span>Decision <b>4</b></span>
              <span>Fun <b>3</b></span>
            </div>
            <div class="landing-policy-line"></div>
            <div class="landing-policy-line short"></div>
          </div>
        </div>
      </section>
      <section class="landing-strip" aria-label="Evaluation loop">
        ${landingMetric("Agents", room ? room.availableAgents.length : 3)}
        ${landingMetric("Scenarios", room ? room.scenarios.length : 3)}
        ${landingMetric("Recent Rooms", state.recentRooms.length)}
        ${landingMetric("Loop", "before/after")}
      </section>
    </section>
  `;
}

function landingMetric(label, value) {
  return `
    <div class="landing-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
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
  messagesEl.querySelectorAll("[data-reply-to-message]").forEach((button) => {
    button.addEventListener("click", () => {
      state.replyTargetId = button.dataset.replyToMessage;
      renderReplyPreview();
      messageInput.focus();
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
      ${renderSystemPerformance(report.systemPerformance)}
      ${renderModelRoutingSummary(report.modelRoutingSummary)}
      ${report.agents.map(renderExpandedAgentReport).join("")}
      ${renderComparison(report)}
      ${renderRunArchive(room)}
    </section>
  `;
}

function renderSystemPerformance(performance = {}) {
  return `
    <article class="report-card">
      <div class="report-title"><strong>System Performance</strong></div>
      <div class="metric-grid">
        ${metric("Active rooms", performance.activeRooms || 0)}
        ${metric("Rooms tracked", performance.roomsTracked || performance.activeRooms || 0)}
        ${metric("Msg/sec", performance.messagesPerSecond || 0)}
        ${metric("WS total", performance.websocketConnectionsTotal || 0)}
        ${metric("Reconnect", formatPercentValue(performance.reconnectRate))}
        ${metric("P50 fanout", `${performance.p50FanoutLatencyMs || 0} ms`)}
        ${metric("P95 fanout", `${performance.p95FanoutLatencyMs || 0} ms`)}
        ${metric("P99 fanout", `${performance.p99FanoutLatencyMs || 0} ms`)}
        ${metric("P50 first token", `${performance.p50FirstTokenLatencyMs || 0} ms`)}
        ${metric("P95 first token", `${performance.p95FirstTokenLatencyMs || 0} ms`)}
        ${metric("P99 first token", `${performance.p99FirstTokenLatencyMs || 0} ms`)}
        ${metric("P50 response", `${performance.p50FullResponseLatencyMs || 0} ms`)}
        ${metric("P95 response", `${performance.p95FullResponseLatencyMs || 0} ms`)}
        ${metric("P99 response", `${performance.p99FullResponseLatencyMs || 0} ms`)}
        ${metric("LLM errors", formatPercentValue(performance.llmErrorRate))}
        ${metric("Timeouts", formatPercentValue(performance.timeoutRate))}
        ${metric("Queue", performance.queueDepth || 0)}
        ${metric("Queue max", performance.maxReportQueueDepth || 0)}
        ${metric("Feedback p95", `${performance.feedbackWriteLatencyMs || 0} ms`)}
        ${metric("Report", `${performance.reportGenerationLatencyMs || 0} ms`)}
      </div>
    </article>
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
        <p><strong>${escapeHtml(report.scenarioTitle)}</strong> · ${escapeHtml(report.policyMode)} · Run ${report.sessionNumber}</p>
        <p>${escapeHtml(shape.summary)}</p>
        <p>
          ${escapeHtml(shape.modelName || "model")} · ${escapeHtml(shape.promptVersion || "prompt")} · ${escapeHtml(shape.policyVersion || "policy")}
        </p>
        <div class="metric-grid">
          ${Object.entries(shape.scorecard)
            .map(([label, value]) => metric(formatTag(label), value))
            .join("")}
        </div>
      </article>
      ${renderShapeStats(shape)}
      ${renderDecisionReview(shape.decisionReview)}
      ${renderFailureModeCard(shape)}
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
          ${(shape.routingRecommendation.recommendedFor || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
        <p><strong>Avoid:</strong> ${(shape.routingRecommendation.avoidFor || []).map(escapeHtml).join(", ") || "No avoid list yet."}</p>
        <p><strong>Route next time:</strong> ${shape.routingRecommendation.routeNextTime ? "Yes" : "No"}</p>
        ${renderRoutingFeedbackVotes(shape.routingRecommendation.sessionFeedback)}
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
  const versionText =
    message.senderType === "ai"
      ? `${message.modelName || "model"} · ${message.promptVersion || "prompt"} · ${message.policyVersion || "policy"}`
      : time;
  const feedback =
    message.senderType === "ai" && !message.streaming
      ? renderFeedbackControls(message)
      : "";
  const replyContext = renderReplyContext(message);
  const replyButton = message.streaming
    ? ""
    : `<button type="button" class="quiet inline-button" data-reply-to-message="${message.id}">Reply</button>`;

  return `
    <article class="message-row ${message.senderType}">
      <div class="avatar">${escapeHtml(initials)}</div>
      <div class="message ${message.senderType} ${aiClass}">
        <div class="message-header">
          <span class="sender">${escapeHtml(message.senderName)}</span>
          <span class="message-actions"><span>${escapeHtml(versionText)}</span>${replyButton}</span>
        </div>
        ${replyContext}
        <p class="${message.streaming ? "streaming" : ""}">${escapeHtml(message.content || " ")}</p>
        ${feedback}
      </div>
    </article>
  `;
}

function renderReplyContext(message) {
  if (!message.replyToMessageId || !state.room) return "";
  const replyTo = state.room.messages.find((candidate) => candidate.id === message.replyToMessageId);
  if (!replyTo) return "";
  return `
    <div class="reply-context">
      <strong>${escapeHtml(replyTo.senderName)}</strong>
      <span>${escapeHtml(truncateText(replyTo.content, 110))}</span>
    </div>
  `;
}

function renderReplyPreview() {
  if (!replyPreviewEl || !state.room || !state.replyTargetId || getViewMode().type !== "chat") {
    if (replyPreviewEl) replyPreviewEl.innerHTML = "";
    return;
  }
  const target = state.room.messages.find((message) => message.id === state.replyTargetId);
  if (!target) {
    clearReplyTarget();
    return;
  }
  replyPreviewEl.innerHTML = `
    <div>
      <strong>Replying to ${escapeHtml(target.senderName)}</strong>
      <span>${escapeHtml(truncateText(target.content, 120))}</span>
    </div>
    <button type="button" class="quiet inline-button" data-clear-reply>Clear</button>
  `;
  const clearButton = replyPreviewEl.querySelector("[data-clear-reply]");
  if (clearButton) clearButton.addEventListener("click", clearReplyTarget);
}

function clearReplyTarget() {
  state.replyTargetId = null;
  if (replyPreviewEl) replyPreviewEl.innerHTML = "";
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
      const target = decision.targetUser ? ` → ${decision.targetUser}` : "";
      return `
        <article class="decision">
          <div class="decision-top">
            <span class="decision-name">${escapeHtml(decision.agentName)}</span>
            <span class="badge ${decision.decision}">${formatDecision(decision.decision)}</span>
          </div>
          <div class="decision-meta">
            ${Math.round(decision.confidence * 100)}% confidence${escapeHtml(target)} · ${escapeHtml(decision.groupState)} · ${escapeHtml(decision.roomType)}
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
          ${renderModelRoutingPlan(route.modelRouting)}
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
              <small>${escapeHtml(formatDecision(candidate.decision || "wait"))}${candidate.decisionModelTier ? ` · ${escapeHtml(candidate.decisionModelTier)}` : ""}</small>
              ${renderRuleAdjustments(candidate.ruleAdjustments)}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRuleAdjustments(ruleAdjustments) {
  if (!Array.isArray(ruleAdjustments) || !ruleAdjustments.length) return "";
  return `<em>${ruleAdjustments.map(escapeHtml).join("; ")}</em>`;
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
    ${renderModelRoutingSummary(report.modelRoutingSummary)}
    ${report.agents.map(renderAgentReport).join("")}
    ${renderComparison(report)}
    ${renderRunArchive(room)}
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
        ${metric("Reply target", `${Math.round((agentReport.stats.replyTargetRate || 0) * 100)}%`)}
        ${metric("Wrong person", `${Math.round((agentReport.stats.wrongPersonFeedbackRate || 0) * 100)}%`)}
        ${metric("Human trend", formatTag(agentReport.stats.humanMomentumDirection || "same"))}
        ${metric("Human lift", signedPercent(agentReport.stats.humanConversationLift || 0))}
        ${metric("Selected", agentReport.stats.routingSelectedCount)}
        ${metric("Should speak", formatDecisionVerdict(agentReport.decisionReview && agentReport.decisionReview.shouldHaveSpoken))}
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
    ${renderDecisionReview(agentReport.decisionReview)}
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

function renderRoutingFeedbackVotes(feedback = {}) {
  if (!feedback) return "";
  return `
    <div class="metric-grid">
      ${metric("Route votes", feedback.routeNextVotes || 0)}
      ${metric("Useful votes", feedback.mostUsefulVotes || 0)}
      ${metric("Annoying votes", feedback.mostAnnoyingVotes || 0)}
    </div>
  `;
}

function renderModelRoutingSummary(summary = {}) {
  const latest = summary.latestPlan || {};
  if (!latest.decision && !latest.router && !latest.message && !latest.report) return "";
  return `
    <article class="report-card">
      <div class="report-title"><strong>Model Routing</strong></div>
      <p>Fast tiers handle classification, speak decisions, routing, and feedback aggregation. Strong tiers handle reports, policy generation, and emotionally complex or conflict-heavy responses.</p>
      <div class="metric-grid">
        ${metric("Plans", summary.routingPlans || 0)}
        ${metric("Fast decisions", summary.fastDecisionRoutes || 0)}
        ${metric("Strong responses", summary.strongMessageRoutes || 0)}
        ${metric("Report tier", summary.reportTier || (latest.report && latest.report.tier) || "strong")}
      </div>
      ${renderModelRoutingPlan(latest)}
    </article>
  `;
}

function renderModelRoutingPlan(plan = {}) {
  const stages = [
    ["classification", "Classification"],
    ["decision", "Decision"],
    ["router", "Router"],
    ["message", "Message"],
    ["feedbackAggregation", "Feedback"],
    ["report", "Report"],
    ["policy", "Policy"],
  ];
  const chips = stages
    .map(([key, label]) => {
      const stage = plan[key];
      if (!stage) return "";
      return `<span class="tag">${escapeHtml(label)} · ${escapeHtml(stage.tier)} · ${escapeHtml(stage.modelName)}</span>`;
    })
    .join("");
  const reasons =
    Array.isArray(plan.escalationReasons) && plan.escalationReasons.length
      ? `<p><strong>Escalation:</strong> ${escapeHtml(plan.escalationReasons.join(", "))}</p>`
      : "";
  if (!chips && !reasons) return "";
  return `<div class="model-routing-plan"><div class="tag-list">${chips}</div>${reasons}</div>`;
}

function renderDecisionReview(review) {
  if (!review) return "";
  const entries = Array.isArray(review.sampledDecisions) ? review.sampledDecisions : [];
  return `
    <article class="report-card decision-review-card">
      <div class="report-title"><strong>Participation Decision Review</strong></div>
      <p>${escapeHtml(review.summary || "No decision review captured yet.")}</p>
      <div class="metric-grid">
        ${metric("Should speak", formatDecisionVerdict(review.shouldHaveSpoken))}
        ${metric("Decisions", review.totalDecisions || 0)}
        ${metric("Speak", review.speakDecisions || 0)}
        ${metric("Wait", review.waitDecisions || 0)}
        ${metric("Silent", review.staySilentDecisions || 0)}
        ${metric("Routed", review.selectedByRouterCount || 0)}
      </div>
      ${renderGroupStateCounts(review.groupStateCounts)}
      <div class="decision-review-list">
        ${entries.map(renderDecisionReviewEntry).join("") || `<p>No sampled decisions yet.</p>`}
      </div>
    </article>
  `;
}

function renderGroupStateCounts(counts = {}) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return "";
  return `
    <div class="tag-list">
      ${entries.map(([state, count]) => `<span class="tag">${formatTag(state)} ${count}</span>`).join("")}
    </div>
  `;
}

function renderDecisionReviewEntry(entry) {
  const adjustments = Array.isArray(entry.ruleAdjustments) ? entry.ruleAdjustments : [];
  const tags = entry.outcome && Array.isArray(entry.outcome.feedbackTags) ? entry.outcome.feedbackTags : [];
  return `
    <div class="decision-review-item">
      <div class="decision-top">
        <span class="badge ${escapeHtml(entry.decision)}">${escapeHtml(formatDecision(entry.decision || "unknown"))}</span>
        <span>${Math.round(Number(entry.confidence || 0) * 100)}% · ${escapeHtml(entry.groupState || "active")}</span>
      </div>
      <p><strong>${escapeHtml(entry.triggerSender || "Trigger")}:</strong> ${escapeHtml(entry.triggerText || "No trigger captured.")}</p>
      <p>${escapeHtml(entry.reason || "No reason captured.")}</p>
      ${
        entry.targetUser
          ? `<p><strong>Target:</strong> ${escapeHtml(entry.targetUser)}</p>`
          : ""
      }
      <p><strong>Router:</strong> ${entry.selectedByRouter ? "selected" : "not selected"}${entry.routeReason ? ` · ${escapeHtml(entry.routeReason)}` : ""}</p>
      ${
        entry.outcome && entry.outcome.messageText
          ? `<p><strong>Message:</strong> ${escapeHtml(entry.outcome.messageText)}</p>`
          : ""
      }
      <div class="tag-list">
        ${adjustments.map((adjustment) => `<span class="tag">${escapeHtml(adjustment)}</span>`).join("")}
        ${tags.map((tag) => `<span class="tag">${formatTag(tag)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderShapeStats(agentReport) {
  const stats = agentReport.stats;
  return `
    <article class="report-card">
      <div class="report-title"><strong>Quantitative Stats</strong></div>
      <div class="metric-grid">
        ${metric("Messages", stats.totalMessages)}
        ${metric("Avg words", stats.averageMessageWords)}
        ${metric("Avg latency", `${stats.averageResponseLatencyMs} ms`)}
        ${metric("Speak", stats.speakDecisions)}
        ${metric("Silent", stats.staySilentDecisions)}
        ${metric("Wait", stats.waitDecisions)}
        ${metric("Speak/silent", stats.speakStaySilentRatio)}
        ${metric("Positive", `${Math.round(stats.positiveFeedbackRate * 100)}%`)}
        ${metric("Negative", `${Math.round(stats.negativeFeedbackRate * 100)}%`)}
        ${metric("Interruption", `${Math.round(stats.interruptionRate * 100)}%`)}
        ${metric("Helped decide", `${Math.round(stats.decisionHelpfulnessRate * 100)}%`)}
        ${metric("Stay quiet", `${Math.round(stats.shouldHaveStayedQuietRate * 100)}%`)}
        ${metric("Targeted", `${Math.round((stats.targetedDecisionRate || 0) * 100)}%`)}
        ${metric("Reply target", `${Math.round((stats.replyTargetRate || 0) * 100)}%`)}
        ${metric("Wrong person", `${Math.round((stats.wrongPersonFeedbackRate || 0) * 100)}%`)}
        ${metric("Quiet target", `${Math.round((stats.quietParticipantTargetRate || 0) * 100)}%`)}
        ${metric("Human before", stats.humanMessagesBeforeAiMessages)}
        ${metric("Human after", stats.humanMessagesAfterAiMessages)}
        ${metric("Human delta", signed(stats.humanConversationDelta || 0))}
        ${metric("Human lift", signedPercent(stats.humanConversationLift || 0))}
        ${metric("Human trend", formatTag(stats.humanMomentumDirection || "same"))}
        ${metric("Route success", `${Math.round(stats.routingSuccessRate * 100)}%`)}
      </div>
      <div class="tag-list">
        ${Object.entries(stats.targetUserCounts || {})
          .map(([name, count]) => `<span class="tag">Target ${escapeHtml(name)} ${count}</span>`)
          .join("")}
        ${Object.entries(stats.feedbackTagCounts)
          .map(([tag, count]) => `<span class="tag">${formatTag(tag)} ${count}</span>`)
          .join("") || `<span class="tag">No feedback tags</span>`}
      </div>
    </article>
  `;
}

function renderFailureModeCard(agentReport) {
  return `
    <article class="report-card">
      <div class="report-title"><strong>Failure Modes</strong></div>
      <div class="tag-list">
        ${agentReport.failureModes.map((mode) => `<span class="tag">${escapeHtml(mode)}</span>`).join("")}
      </div>
    </article>
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
            ${renderExampleContext(example.surroundingContext)}
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

function renderExampleContext(context) {
  if (!Array.isArray(context) || !context.length) return "";
  return `
    <div class="example-context">
      ${context
        .map(
          (message) => `
            <div>
              <strong>${escapeHtml(message.senderName)}</strong>
              <span>${escapeHtml(message.senderType)}</span>
              <p>${escapeHtml(message.content)}</p>
            </div>
          `,
        )
        .join("")}
    </div>
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

function renderRunArchive(room) {
  if (!room) return "";
  const currentReports = (room.reports || []).filter(
    (report) => report.sessionNumber === room.sessionNumber && report.policyMode === room.policyMode,
  );
  const currentRun = {
    id: `${room.id}:current`,
    policyMode: room.policyMode,
    sessionNumber: room.sessionNumber,
    scenarioTitle: room.scenario && room.scenario.title,
    messages: room.messages || [],
    decisions: room.decisions || [],
    feedback: room.feedback || [],
    reports: currentReports,
    archivedAt: null,
  };
  const runs = [...(Array.isArray(room.runHistory) ? room.runHistory : []), currentRun].filter(
    (run) =>
      (Array.isArray(run.messages) && run.messages.length) ||
      (Array.isArray(run.transcript) && run.transcript.length) ||
      (Array.isArray(run.reports) && run.reports.length),
  );
  if (runs.length < 2) return "";

  return `
    <article class="report-card">
      <div class="report-title"><strong>Run Archive</strong></div>
      <div class="metric-grid">
        ${metric("Runs", runs.length)}
        ${metric("Archived", Math.max(0, runs.length - 1))}
        ${metric("Baseline", runs.some((run) => run.policyMode === "baseline") ? "yes" : "no")}
        ${metric("Improved", runs.some((run) => run.policyMode === "improved") ? "yes" : "no")}
      </div>
      <div class="room-list">
        ${runs
          .map((run) => {
            const messageCount = Array.isArray(run.transcript)
              ? run.transcript.length
              : Array.isArray(run.messages)
                ? run.messages.length
                : 0;
            const decisionCount = Array.isArray(run.decisions) ? run.decisions.length : 0;
            const feedbackCount = Array.isArray(run.feedback) ? run.feedback.length : 0;
            const reportCount = Array.isArray(run.reports) ? run.reports.length : 0;
            return `
              <div class="room-list-item">
                <div>
                  <strong>${escapeHtml(formatTag(run.policyMode || "run"))} · Run ${escapeHtml(String(run.sessionNumber || "?"))}</strong>
                  <span>${escapeHtml(run.scenarioTitle || room.scenario.title)} · ${messageCount} messages · ${decisionCount} decisions · ${feedbackCount} feedback tags · ${reportCount} reports</span>
                </div>
                <span class="status-pill">${run.archivedAt ? "archived" : "current"}</span>
              </div>
            `;
          })
          .join("")}
      </div>
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
      <span>${Math.round(Number(values.replyTargetRate || 0) * 100)}% reply-targeted</span>
      <span>${Math.round(Number(values.wrongPersonFeedbackRate || 0) * 100)}% wrong-person feedback</span>
      <span>human trend ${escapeHtml(formatTag(values.humanMomentumDirection || "same"))}</span>
      <span>human lift ${escapeHtml(signedPercent(values.humanConversationLift || 0))}</span>
      <span>Timing ${escapeHtml(String(values.timingScore || 0))} · Restraint ${escapeHtml(String(values.restraintScore || 0))}</span>
    </div>
  `;
}

function getSelectedAgentIds() {
  const inputs = [...agentTogglesEl.querySelectorAll("input[type='checkbox']")];
  const available = inputs.map((input) => input.value);
  const selected = inputs.filter((input) => input.checked).map((input) => input.value);
  return normalizeSelectedAgentIds(selected, available, getAgentSelectionRules());
}

function getAgentSelectionRules() {
  return state.room && state.room.agentSelectionRules ? state.room.agentSelectionRules : { min: 2, max: 3 };
}

function syncAgentToggleConstraints(changedInput) {
  const inputs = [...agentTogglesEl.querySelectorAll("input[type='checkbox']")];
  if (!inputs.length) return;

  const rules = getAgentSelectionRules();
  let checked = inputs.filter((input) => input.checked);

  if (checked.length > rules.max) {
    for (const input of checked) {
      if (checked.length <= rules.max) break;
      if (input === changedInput) continue;
      input.checked = false;
      checked = inputs.filter((candidate) => candidate.checked);
    }
  }

  if (checked.length < rules.min && changedInput && !changedInput.checked) {
    changedInput.checked = true;
    checked = inputs.filter((input) => input.checked);
  }

  for (const input of inputs) {
    if (checked.length >= rules.min) break;
    if (!input.checked) {
      input.checked = true;
      checked.push(input);
    }
  }
}

function normalizeSelectedAgentIds(selected, available, rules) {
  const unique = [...new Set(selected.filter((agentId) => available.includes(agentId)))];
  const normalized = unique.length ? unique : available.slice();

  for (const agentId of available) {
    if (normalized.length >= rules.min) break;
    if (!normalized.includes(agentId)) normalized.push(agentId);
  }

  return normalized.slice(0, rules.max);
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
  if (view.type === "create" || view.type === "landing") return;
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
  if (parts.length === 0) {
    return { type: "landing" };
  }
  if (parts[0] === "create") {
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
    const view = getViewMode();
    if (view.type === "create") renderCreatePage();
    if (view.type === "landing") renderLandingPage();
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

function formatPercentValue(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDecision(decision) {
  return String(decision || "").replace("_", " ");
}

function formatDecisionVerdict(value) {
  const labels = {
    yes: "Yes",
    no: "No",
    mixed: "Mixed",
    not_tested: "Not tested",
    insufficient_evidence: "Insufficient",
  };
  return labels[value] || "Unknown";
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

function signedPercent(value) {
  const number = Math.round(Number(value || 0) * 100);
  return number > 0 ? `+${number}%` : `${number}%`;
}

function sumObjectValues(values) {
  return Object.values(values || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
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
