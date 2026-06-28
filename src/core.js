const { randomUUID } = require("crypto");

const scenarios = [
  {
    id: "weekend_trip",
    title: "Weekend Trip Planning",
    roomType: "planning",
    premise:
      "Four friends are planning a weekend trip. Budget, nightlife, nature, and derailing side chatter are all in play.",
    sampleScript: [
      ["Alex", "I need this to stay cheap, but I still want it to feel like a real weekend."],
      ["Jules", "I mostly care about nightlife. If everything closes at 8, I am out."],
      ["Sam", "I want nature too. A lake or trails would make it worth the drive."],
      ["Taylor", "What if we stop debating and vote between cheap city, cabin, or lake town?"],
    ],
  },
  {
    id: "group_project",
    title: "Group Project Triage",
    roomType: "study_work",
    premise:
      "A small team is behind on a project. One person wants scope cuts, one wants quality, and one is going quiet.",
    sampleScript: [
      ["Mina", "We are behind and I think we need to cut scope or this will be messy."],
      ["Dev", "I hate cutting features when the whole point was to make this feel polished."],
      ["Noor", "I can help tonight, but I am not sure what the highest priority task is."],
      ["Mina", "Can we decide what absolutely has to ship by tomorrow?"],
    ],
  },
  {
    id: "friend_conflict",
    title: "Friend Group Conflict",
    roomType: "drama_conflict",
    premise:
      "Friends are trying to choose dinner plans, but one person feels ignored and another keeps joking through it.",
    sampleScript: [
      ["Rae", "I feel like nobody is listening when I say I cannot do spicy food tonight."],
      ["Cam", "It was just a suggestion, no need to make it a whole thing."],
      ["Lee", "Can we pick somewhere that is not going to turn into another argument?"],
      ["Rae", "I just want one option that works for everyone."],
    ],
  },
];

const defaultScenarioId = "weekend_trip";
const agentSelectionRules = {
  min: 2,
  max: 3,
};

const feedbackDefinitions = {
  helpful: {
    label: "Helpful",
    sentiment: "positive",
    category: "message_quality",
  },
  funny: {
    label: "Funny",
    sentiment: "positive",
    category: "message_quality",
  },
  boring: {
    label: "Boring",
    sentiment: "negative",
    category: "message_quality",
  },
  confusing: {
    label: "Confusing",
    sentiment: "negative",
    category: "message_quality",
  },
  out_of_character: {
    label: "Out of character",
    sentiment: "negative",
    category: "personality",
  },
  wrong_tone: {
    label: "Wrong tone",
    sentiment: "negative",
    category: "message_quality",
  },
  buggy: {
    label: "Buggy",
    sentiment: "negative",
    category: "message_quality",
  },
  dislike_response_style: {
    label: "Bad style",
    sentiment: "negative",
    category: "message_quality",
  },
  helped_us_decide: {
    label: "Helped decide",
    sentiment: "positive",
    category: "group_usefulness",
  },
  good_timing: {
    label: "Good timing",
    sentiment: "positive",
    category: "timing",
  },
  revived_dead_chat: {
    label: "Revived chat",
    sentiment: "positive",
    category: "timing",
  },
  made_chat_fun: {
    label: "Made it fun",
    sentiment: "positive",
    category: "group_usefulness",
  },
  created_momentum: {
    label: "Created momentum",
    sentiment: "positive",
    category: "group_usefulness",
  },
  asked_useful_question: {
    label: "Useful question",
    sentiment: "positive",
    category: "group_usefulness",
  },
  good_read: {
    label: "Good read",
    sentiment: "positive",
    category: "social_awareness",
  },
  reduced_tension: {
    label: "Reduced tension",
    sentiment: "positive",
    category: "social_awareness",
  },
  stayed_in_character: {
    label: "Stayed in character",
    sentiment: "positive",
    category: "personality",
  },
  matched_group_vibe: {
    label: "Matched vibe",
    sentiment: "positive",
    category: "personality",
  },
  should_have_stayed_quiet: {
    label: "Should stay quiet",
    sentiment: "negative",
    category: "timing",
  },
  interrupted_humans: {
    label: "Interrupted",
    sentiment: "negative",
    category: "timing",
  },
  responded_too_late: {
    label: "Too late",
    sentiment: "negative",
    category: "timing",
  },
  responded_too_often: {
    label: "Too often",
    sentiment: "negative",
    category: "timing",
  },
  too_verbose: {
    label: "Too verbose",
    sentiment: "negative",
    category: "brevity",
  },
  wrong_vibe: {
    label: "Wrong vibe",
    sentiment: "negative",
    category: "personality",
  },
  broke_character: {
    label: "Broke character",
    sentiment: "negative",
    category: "personality",
  },
  too_assistant_like: {
    label: "Too assistant-like",
    sentiment: "negative",
    category: "personality",
  },
  too_generic: {
    label: "Too generic",
    sentiment: "negative",
    category: "personality",
  },
  ignored_quiet_person: {
    label: "Ignored quiet person",
    sentiment: "negative",
    category: "social_awareness",
  },
  misread_room: {
    label: "Misread room",
    sentiment: "negative",
    category: "social_awareness",
  },
  responded_wrong_person: {
    label: "Wrong person",
    sentiment: "negative",
    category: "social_awareness",
  },
  missed_social_tension: {
    label: "Missed tension",
    sentiment: "negative",
    category: "social_awareness",
  },
  escalated_tension: {
    label: "Escalated tension",
    sentiment: "negative",
    category: "social_awareness",
  },
  killed_momentum: {
    label: "Killed momentum",
    sentiment: "negative",
    category: "group_usefulness",
  },
  made_chat_less_human: {
    label: "Less human",
    sentiment: "negative",
    category: "group_usefulness",
  },
  repeated_obvious_info: {
    label: "Repeated obvious info",
    sentiment: "negative",
    category: "group_usefulness",
  },
};

const agents = [
  {
    id: "mediator_v1",
    name: "Mediator",
    role: "Decision helper",
    color: "#2f6f73",
    version: "1.1.0",
    promptVersion: "mediator_prompt_v1",
    policyVersion: "mediator_policy_baseline_v1",
    modelName: "local-policy-sim-v1",
    basePersonality:
      "Calm, concise, concrete. Helps groups turn scattered preferences into a decision.",
    baselinePolicy:
      "Help the group by giving useful suggestions and summarizing the conversation.",
    improvedPolicy:
      "Speak only when the group is stalled, confused, tense, or needs a concrete decision. Avoid summarizing while humans are actively exchanging ideas. Prefer short decision-forcing questions.",
    routingFit: ["planning rooms", "decision-heavy rooms", "conflict resolution"],
  },
  {
    id: "vibe_friend_v1",
    name: "Vibe Friend",
    role: "Social energy",
    color: "#9b5a2e",
    version: "1.1.0",
    promptVersion: "vibe_prompt_v1",
    policyVersion: "vibe_policy_baseline_v1",
    modelName: "local-policy-sim-v1",
    basePersonality:
      "Brief, casual, warm. Keeps the group socially alive without becoming the center.",
    baselinePolicy:
      "Keep the room lively by adding jokes, casual reactions, and social energy.",
    improvedPolicy:
      "Speak only when the room is losing energy or a light comment helps humans keep talking. Stay quiet during useful planning momentum.",
    routingFit: ["casual rooms", "playful rooms", "low-energy rooms"],
  },
  {
    id: "observer_v1",
    name: "Observer",
    role: "Rare intervention",
    color: "#695aa6",
    version: "1.0.0",
    promptVersion: "observer_prompt_v1",
    policyVersion: "observer_policy_baseline_v1",
    modelName: "local-policy-sim-v1",
    basePersonality:
      "Quiet, perceptive, low-ego. Speaks rarely when tension, silence, or ignored constraints need attention.",
    baselinePolicy:
      "Watch the room and speak when a quiet but useful observation can improve the group dynamic.",
    improvedPolicy:
      "Stay silent by default. Speak only to name unresolved tension, include a quiet participant, or surface a constraint the group is missing. Keep interventions under two sentences.",
    routingFit: ["tense rooms", "emotionally sensitive rooms", "rooms with quiet participants"],
  },
];

function createRoom(id = "demo-room", options = {}) {
  const selectedAgents = normalizeAgentIds(options.agentIds);
  const scenario = getScenario(options.scenarioId || defaultScenarioId);

  return {
    id: normalizeRoomId(id),
    scenario,
    selectedAgentIds: selectedAgents,
    status: "active",
    policyMode: "baseline",
    currentPolicyVersion: "baseline_v1",
    routerVersion: "rule_router_v1",
    sessionNumber: 1,
    createdAt: new Date().toISOString(),
    endedAt: null,
    messages: [],
    decisions: [],
    routingDecisions: [],
    reportJobs: [],
    feedback: [],
    sessionFeedback: [],
    reports: [],
    participants: new Map(),
    currentGroupState: "active",
    runtimeMetrics: createRuntimeMetrics(),
    activePolicyOverrides: {},
  };
}

function hydrateRoom(snapshot = {}) {
  const room = createRoom(snapshot.id || "demo-room", {
    scenarioId: snapshot.scenario ? snapshot.scenario.id : snapshot.scenarioId,
    agentIds: snapshot.selectedAgentIds,
  });

  room.status = snapshot.status || room.status;
  room.policyMode = snapshot.policyMode || room.policyMode;
  room.currentPolicyVersion = snapshot.currentPolicyVersion || room.currentPolicyVersion;
  room.routerVersion = snapshot.routerVersion || room.routerVersion;
  room.sessionNumber = Number(snapshot.sessionNumber || room.sessionNumber);
  room.createdAt = snapshot.createdAt || room.createdAt;
  room.endedAt = snapshot.endedAt || null;
  room.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  room.decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];
  room.routingDecisions = Array.isArray(snapshot.routingDecisions) ? snapshot.routingDecisions : [];
  room.reportJobs = Array.isArray(snapshot.reportJobs) ? snapshot.reportJobs : [];
  room.feedback = Array.isArray(snapshot.feedback) ? snapshot.feedback : [];
  room.sessionFeedback = Array.isArray(snapshot.sessionFeedback) ? snapshot.sessionFeedback : [];
  room.reports = Array.isArray(snapshot.reports) ? snapshot.reports : [];
  room.currentGroupState = snapshot.currentGroupState || room.currentGroupState;
  room.runtimeMetrics = hydrateRuntimeMetrics(snapshot.runtimeMetrics);
  room.activePolicyOverrides =
    snapshot.activePolicyOverrides && typeof snapshot.activePolicyOverrides === "object"
      ? snapshot.activePolicyOverrides
      : {};
  room.participants = new Map(
    (Array.isArray(snapshot.participants) ? snapshot.participants : []).map((participant) => [
      participant.id,
      participant,
    ]),
  );

  return room;
}

function setRoomConfig(room, input = {}) {
  if (input.scenarioId) {
    room.scenario = getScenario(input.scenarioId);
  }
  if (input.agentIds) {
    room.selectedAgentIds = normalizeAgentIds(input.agentIds);
  }
  return room;
}

function resetRoomForNextRun(room, policyMode = room.policyMode) {
  const shouldPreserveGeneratedPolicyVersion =
    policyMode === "improved" &&
    room.activePolicyOverrides &&
    Object.keys(room.activePolicyOverrides).length > 0 &&
    String(room.currentPolicyVersion || "").startsWith("improved_from_");
  const currentPolicyVersion = shouldPreserveGeneratedPolicyVersion
    ? room.currentPolicyVersion
    : `${policyMode}_v${room.sessionNumber}`;
  room.status = "active";
  room.endedAt = null;
  room.policyMode = policyMode;
  room.currentPolicyVersion = currentPolicyVersion;
  room.messages = [];
  room.decisions = [];
  room.routingDecisions = [];
  room.reportJobs = [];
  room.feedback = [];
  room.sessionFeedback = [];
  room.currentGroupState = "active";
  room.runtimeMetrics = createRuntimeMetrics();
  return room;
}

function createRuntimeMetrics() {
  return {
    websocketConnections: 0,
    websocketDisconnects: 0,
    fanoutLatenciesMs: [],
    feedbackWriteLatenciesMs: [],
    llmErrors: 0,
    timeouts: 0,
  };
}

function hydrateRuntimeMetrics(snapshot = {}) {
  return {
    websocketConnections: Number(snapshot.websocketConnections || 0),
    websocketDisconnects: Number(snapshot.websocketDisconnects || 0),
    fanoutLatenciesMs: Array.isArray(snapshot.fanoutLatenciesMs) ? snapshot.fanoutLatenciesMs : [],
    feedbackWriteLatenciesMs: Array.isArray(snapshot.feedbackWriteLatenciesMs)
      ? snapshot.feedbackWriteLatenciesMs
      : [],
    llmErrors: Number(snapshot.llmErrors || 0),
    timeouts: Number(snapshot.timeouts || 0),
  };
}

function addParticipant(room, displayName, connectionId) {
  const trimmedName = normalizeDisplayName(displayName);
  const participant = {
    id: connectionId || randomUUID(),
    displayName: trimmedName,
    participantType: "human",
    joinedAt: new Date().toISOString(),
  };
  room.participants.set(participant.id, participant);
  return participant;
}

function normalizeDisplayName(displayName) {
  const trimmed = String(displayName || "").trim();
  return trimmed.slice(0, 28) || "Human";
}

function normalizeRoomId(id) {
  const normalized = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.slice(0, 48) || randomUUID().slice(0, 8);
}

function addHumanMessage(room, displayName, content) {
  const message = createMessage(room, {
    senderName: normalizeDisplayName(displayName),
    senderType: "human",
    content,
  });
  room.messages.push(message);
  return message;
}

function createAgentPlaceholder(room, agentId, decisionId) {
  const agent = getAgent(agentId);
  const message = createMessage(room, {
    senderName: agent.name,
    senderType: "ai",
    agentId,
    content: "",
    decisionId,
    modelName: agent.modelName,
    promptVersion: agent.promptVersion,
    policyVersion: effectiveAgentPolicyVersion(agent, room),
  });
  message.streaming = true;
  room.messages.push(message);
  return message;
}

function finalizeAgentMessage(message, content, latencyMs) {
  message.content = content;
  message.streaming = false;
  message.latencyMs = latencyMs;
  message.tokenCount = countWords(content);
  return message;
}

function createMessage(room, input) {
  return {
    id: randomUUID(),
    roomId: room.id,
    senderName: input.senderName,
    senderType: input.senderType,
    agentId: input.agentId || null,
    content: String(input.content || "").slice(0, 2000),
    createdAt: new Date().toISOString(),
    replyToMessageId: input.replyToMessageId || null,
    decisionId: input.decisionId || null,
    latencyMs: input.latencyMs || null,
    firstTokenLatencyMs: input.firstTokenLatencyMs || null,
    tokenCount: input.tokenCount || null,
    modelName: input.modelName || null,
    promptVersion: input.promptVersion || null,
    policyVersion: input.policyVersion || null,
    feedback: [],
    streaming: false,
  };
}

function evaluateAndRouteAgents(room, triggerMessage) {
  const rawDecisions = createAgentDecisions(room, triggerMessage);
  return routeAgentDecisions(room, triggerMessage, rawDecisions);
}

function createAgentDecisions(room, triggerMessage) {
  const roomAgents = getRoomAgents(room);
  return roomAgents.map((agent) => decideForAgent(agent, room, triggerMessage));
}

function routeAgentDecisions(room, triggerMessage, rawDecisions) {
  const { routingDecision, routedDecisions } = buildRoutingDecision(room, triggerMessage, rawDecisions);
  return recordRoutedDecisions(room, routingDecision, routedDecisions);
}

function buildRoutingDecision(room, triggerMessage, rawDecisions) {
  const signals = extractSignals(room, triggerMessage);
  const policyResult = applyRoutingPolicy(room, signals, rawDecisions);
  const routedInput = policyResult.decisions;
  const candidates = routedInput
    .filter((decision) => decision.decision === "speak")
    .sort((a, b) => b.confidence - a.confidence);
  const winner = pickRoutedWinner(room, signals, candidates) || null;
  const routeReason = winner
    ? routingReasonForWinner(room, signals, winner)
    : policyResult.noWinnerReason || "No agent crossed the speak threshold.";
  const routingDecision = {
    id: randomUUID(),
    roomId: room.id,
    triggerMessageId: triggerMessage.id,
    routerVersion: room.routerVersion,
    routerModelName: "local-rule-router",
    roomType: room.scenario.roomType,
    groupState: signals.groupState || (routedInput[0] ? routedInput[0].groupState : room.currentGroupState),
    selectedAgentId: winner ? winner.agentId : null,
    selectedAgentName: winner ? winner.agentName : null,
    reason: routeReason,
    candidateScores: routedInput.map((decision) => ({
      agentId: decision.agentId,
      agentName: decision.agentName,
      decision: decision.decision,
      confidence: decision.confidence,
      groupState: decision.groupState,
      ruleAdjustments: decision.ruleAdjustments || [],
    })),
    blockedAgentIds: routedInput
      .filter((decision) => decision.ruleBlocked || (winner && decision.agentId !== winner.agentId && decision.decision === "speak"))
      .map((decision) => decision.agentId),
    createdAt: new Date().toISOString(),
  };

  const routed = routedInput.map((decision) => {
    const route = {
      routingDecisionId: routingDecision.id,
      routerVersion: room.routerVersion,
      routerModelName: routingDecision.routerModelName,
      roomType: room.scenario.roomType,
      groupState: decision.groupState,
      selectedAgentId: winner ? winner.agentId : null,
      reason: routeReason,
    };

    if (!winner || decision.id === winner.id || decision.decision !== "speak") {
      return { ...decision, route };
    }

    return {
      ...decision,
      decision: "wait",
      reason: `Router held back because ${winner.agentName} had the stronger fit for this turn.`,
      route,
    };
  });

  return { routingDecision, routedDecisions: routed };
}

function applyRoutingPolicy(room, signals, rawDecisions) {
  const feedbackStats = buildRoutingFeedbackStats(room);
  let noWinnerReason = null;
  const decisions = rawDecisions.map((decision) => {
    const stats = feedbackStats[decision.agentId] || createEmptyRoutingFeedbackStats();
    const adjusted = {
      ...decision,
      confidence: Number(decision.confidence || 0),
      groupState: signals.groupState || decision.groupState,
      ruleAdjustments: [],
    };

    if (stats.shouldStayQuietRate > 0.2 || stats.interruptionRate > 0.25) {
      adjusted.confidence -= 0.22;
      adjusted.ruleAdjustments.push("raised restraint after timing feedback");
    }

    if (stats.helpedDecideRate > 0.3 && room.scenario.roomType === "planning" && decision.agentId === "mediator_v1") {
      adjusted.confidence += 0.12;
      adjusted.ruleAdjustments.push("boosted after decision-helpfulness feedback");
    }

    if (signals.tension && decision.agentId === "vibe_friend_v1") {
      adjusted.decision = "wait";
      adjusted.ruleBlocked = true;
      adjusted.ruleAdjustments.push("blocked Vibe Friend in tense room");
    }

    if (signals.playful && signals.activeHumanExchange) {
      if (decision.agentId === "vibe_friend_v1" && adjusted.confidence < 0.8) {
        adjusted.decision = "stay_silent";
        adjusted.ruleBlocked = true;
        adjusted.ruleAdjustments.push("held Vibe Friend below 80% confidence during playful human momentum");
      }
      if (decision.agentId !== "vibe_friend_v1") {
        adjusted.confidence -= 0.18;
        adjusted.ruleAdjustments.push("down-ranked non-vibe agent in playful momentum");
      }
    }

    adjusted.confidence = round(Math.max(0, Math.min(0.99, adjusted.confidence)));
    if (adjusted.decision === "speak" && adjusted.confidence < thresholdFor(adjusted.agentId, room.policyMode === "improved")) {
      adjusted.decision = signals.activeHumanExchange ? "stay_silent" : "wait";
      adjusted.ruleAdjustments.push("fell below policy speak threshold after routing adjustments");
    }

    if (adjusted.ruleAdjustments.length) {
      adjusted.reason = `${adjusted.reason} Router: ${adjusted.ruleAdjustments.join("; ")}.`;
    }

    return adjusted;
  });

  if (!decisions.some((decision) => decision.decision === "speak")) {
    noWinnerReason = "Routing policy held all agents back for this turn.";
  }

  return { decisions, noWinnerReason };
}

function pickRoutedWinner(room, signals, candidates) {
  if (!candidates.length) return null;

  if (signals.tension) {
    return (
      candidates.find((decision) => decision.agentId === "observer_v1") ||
      candidates.find((decision) => decision.agentId === "mediator_v1") ||
      null
    );
  }

  if (room.scenario.roomType === "planning" && signals.decisionNeeded) {
    return candidates.find((decision) => decision.agentId === "mediator_v1") || candidates[0];
  }

  if (signals.playful) {
    return candidates.find((decision) => decision.agentId === "vibe_friend_v1") || candidates[0];
  }

  return candidates[0];
}

function routingReasonForWinner(room, signals, winner) {
  if (signals.tension && ["observer_v1", "mediator_v1"].includes(winner.agentId)) {
    return `${winner.agentName} was routed because tense rooms need low-ego mediation, not extra social energy.`;
  }
  if (room.scenario.roomType === "planning" && signals.decisionNeeded && winner.agentId === "mediator_v1") {
    return "Mediator was routed because a planning room needed a concrete decision.";
  }
  if (signals.playful && winner.agentId === "vibe_friend_v1") {
    return "Vibe Friend was routed because the room was playful and its confidence cleared the social-energy threshold.";
  }
  return `${winner.agentName} had the strongest ${winner.groupState} fit.`;
}

function buildRoutingFeedbackStats(room) {
  return getRoomAgents(room).reduce((statsByAgent, agent) => {
    const messages = room.messages.filter((message) => message.agentId === agent.id);
    const feedback = room.feedback.filter((entry) =>
      messages.some((message) => message.id === entry.messageId),
    );
    const tagCounts = countBy(feedback, "tag");
    const messageCount = Math.max(1, messages.length);
    statsByAgent[agent.id] = {
      interruptionRate: round((messages.filter((message) => wasLikelyInterruption(room, message)).length + (tagCounts.interrupted_humans || 0)) / messageCount),
      shouldStayQuietRate: round((tagCounts.should_have_stayed_quiet || 0) / messageCount),
      helpedDecideRate: round(((tagCounts.helped_us_decide || 0) + (tagCounts.asked_useful_question || 0)) / messageCount),
    };
    return statsByAgent;
  }, {});
}

function createEmptyRoutingFeedbackStats() {
  return {
    interruptionRate: 0,
    shouldStayQuietRate: 0,
    helpedDecideRate: 0,
  };
}

function recordRoutedDecisions(room, routingDecision, routedDecisions) {
  room.currentGroupState = routingDecision.groupState || "active";
  room.routingDecisions.push(routingDecision);
  room.decisions.push(...routedDecisions);
  return routedDecisions;
}

function decideForAgent(agent, room, triggerMessage) {
  const signals = extractSignals(room, triggerMessage);
  const improved = room.policyMode === "improved";
  const lastAgentMessage = [...room.messages]
    .reverse()
    .find((message) => message.agentId === agent.id && message.id !== triggerMessage.id);
  const recentlySpoke =
    lastAgentMessage &&
    room.messages.slice(-4).some((message) => message.id === lastAgentMessage.id);

  let confidence = baseConfidence(agent.id);
  const reasons = [];

  if (agent.id === "mediator_v1") {
    if (signals.decisionNeeded) {
      confidence += improved ? 0.5 : 0.36;
      reasons.push("the room needs a concrete decision");
    }
    if (signals.constraints.length >= 2) {
      confidence += improved ? 0.28 : 0.22;
      reasons.push("multiple constraints are competing");
    }
    if (signals.tension) {
      confidence += improved ? 0.24 : 0.18;
      reasons.push("there is tension to reduce");
    }
    if (!improved && signals.humanCount >= 3) {
      confidence += 0.18;
      reasons.push("enough context exists to summarize");
    }
    if (improved && signals.activeHumanExchange && !signals.tension && !signals.decisionNeeded) {
      confidence -= 0.34;
      reasons.push("humans are already making progress");
    }
  }

  if (agent.id === "vibe_friend_v1") {
    if (signals.playful || signals.derailed) {
      confidence += improved ? 0.32 : 0.38;
      reasons.push("the group is in a playful or derailing moment");
    }
    if (signals.lowEnergy) {
      confidence += improved ? 0.36 : 0.18;
      reasons.push("the room needs energy");
    }
    if (!improved && signals.humanCount >= 1) {
      confidence += 0.16;
      reasons.push("a casual reaction can keep the chat lively");
    }
    if (improved && (signals.activeHumanExchange || signals.decisionNeeded || signals.tension)) {
      confidence -= 0.42;
      reasons.push("planning momentum should not be interrupted");
    }
  }

  if (agent.id === "observer_v1") {
    if (signals.tension) {
      confidence += improved ? 0.52 : 0.38;
      reasons.push("tension needs a low-ego intervention");
    }
    if (signals.quietParticipantRisk) {
      confidence += improved ? 0.32 : 0.2;
      reasons.push("a quieter participant may need to be included");
    }
    if (signals.confusion || signals.constraints.length >= 3) {
      confidence += improved ? 0.26 : 0.18;
      reasons.push("the room has unresolved constraints");
    }
    if (!signals.tension && signals.activeHumanExchange) {
      confidence -= improved ? 0.38 : 0.18;
      reasons.push("the human exchange should continue");
    }
  }

  if (recentlySpoke) {
    confidence -= improved ? 0.3 : 0.12;
    reasons.push("this agent spoke recently");
  }

  const threshold = thresholdFor(agent.id, improved);
  const decision = confidence >= threshold ? "speak" : signals.activeHumanExchange ? "stay_silent" : "wait";

  return {
    id: randomUUID(),
    roomId: room.id,
    triggerMessageId: triggerMessage.id,
    agentId: agent.id,
    agentName: agent.name,
    decision,
    targetUser: targetUserForDecision(agent, signals, triggerMessage),
    reason: reasons[0] || "no high-leverage opening detected",
    confidence: round(Math.max(0, Math.min(0.99, confidence))),
    groupState: signals.groupState,
    roomType: room.scenario.roomType,
    modelName: agent.modelName,
    promptVersion: agent.promptVersion,
    policyVersion: effectiveAgentPolicyVersion(agent, room),
    createdAt: new Date().toISOString(),
  };
}

function generateAgentReply(room, decision) {
  const trigger = room.messages.find((message) => message.id === decision.triggerMessageId);
  const improved = room.policyMode === "improved";
  const signals = extractSignals(room, trigger);
  const constraints = signals.constraints;

  if (decision.agentId === "mediator_v1") {
    if (improved) {
      if (signals.tension) {
        return "Let's split the decision: first agree on the non-negotiable constraint, then pick inside it.";
      }
      if (constraints.includes("budget") && constraints.includes("nightlife")) {
        return "Budget vs nightlife is the fork. Cheap city weekend or cabin plus one night out?";
      }
      if (constraints.includes("nature") && constraints.includes("nightlife")) {
        return "The overlap sounds like a small city near trails. Want to vote on that lane?";
      }
      return "What is the one constraint we are optimizing for first: cost, energy, or comfort?";
    }

    return "Let me summarize the situation: we have budget concerns, nightlife preferences, nature or quality preferences, and some side chatter, so the best path is probably to compare a few options before making a decision.";
  }

  if (decision.agentId === "vibe_friend_v1") {
    if (improved) {
      if (signals.lowEnergy) {
        return "Tiny vote check: practical option, fun option, or compromise option?";
      }
      return "The compromise option is getting suspiciously reasonable.";
    }

    return "Okay this needs main-character energy, but maybe with a budget spreadsheet quietly hiding in the background.";
  }

  if (decision.agentId === "observer_v1") {
    if (signals.tension) {
      return "One thing to separate: the plan choice and whether people feel heard. Solve the heard part first.";
    }
    if (signals.quietParticipantRisk) {
      return decision.targetUser
        ? `Before locking it in, I would check what ${decision.targetUser} thinks.`
        : "Before locking it in, I would check with whoever has spoken least.";
    }
    return "The unresolved constraint seems to be what matters most, not how many options are on the table.";
  }

  return "I can help if the room gets stuck.";
}

function addFeedback(room, messageId, tag, userId) {
  if (!feedbackDefinitions[tag]) {
    throw new Error(`Unknown feedback tag: ${tag}`);
  }

  const message = room.messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    throw new Error(`Unknown message: ${messageId}`);
  }

  const feedback = {
    id: randomUUID(),
    messageId,
    roomId: room.id,
    userId: userId || "demo_user",
    tag,
    label: feedbackDefinitions[tag].label,
    sentiment: feedbackDefinitions[tag].sentiment,
    createdAt: new Date().toISOString(),
  };

  room.feedback.push(feedback);
  message.feedback.push(feedback);
  return feedback;
}

function addSessionFeedback(room, input = {}, userId = "demo_user") {
  const feedback = {
    id: randomUUID(),
    roomId: room.id,
    userId,
    mostUsefulAgentId: normalizeOptionalAgentId(input.mostUsefulAgentId),
    mostAnnoyingAgentId: normalizeOptionalAgentId(input.mostAnnoyingAgentId),
    routeNextAgentId: normalizeOptionalAgentId(input.routeNextAgentId),
    didReachDecision: Boolean(input.didReachDecision),
    wouldInviteAgain: Boolean(input.wouldInviteAgain),
    humansTalkedMoreOrLess: normalizeTalkedMoreLess(input.humansTalkedMoreOrLess),
    freeformNotes: String(input.freeformNotes || "").trim().slice(0, 1200),
    createdAt: new Date().toISOString(),
  };
  room.sessionFeedback.push(feedback);
  return feedback;
}

function buildReport(room, options = {}) {
  const replaceLatest = Boolean(options.replaceLatest);
  const replacementIndex = replaceLatest ? room.reports.length - 1 : -1;
  const reportId =
    replaceLatest && replacementIndex >= 0 && room.reports[replacementIndex]
      ? room.reports[replacementIndex].id
      : randomUUID();
  const agentReports = getRoomAgents(room).map((agent) => buildAgentReport(room, agent));
  const previousReport =
    replaceLatest && replacementIndex >= 0
      ? room.reports
          .slice(0, replacementIndex)
          .reverse()
          .find((candidate) => candidate.sessionNumber !== room.sessionNumber || candidate.policyMode !== room.policyMode) || null
      : room.reports[room.reports.length - 1] || null;
  const report = {
    id: reportId,
    roomId: room.id,
    scenarioId: room.scenario.id,
    scenarioTitle: room.scenario.title,
    sessionNumber: room.sessionNumber,
    policyMode: room.policyMode,
    routerVersion: room.routerVersion,
    createdAt: new Date().toISOString(),
    summary: summarizeSession(agentReports, room),
    roomStats: buildRoomStats(room),
    sessionFeedbackSummary: summarizeSessionFeedback(room),
    systemPerformance: buildSystemPerformance(room, options.systemContext),
    agents: agentReports,
    comparison: previousReport ? compareReports(previousReport, agentReports) : [],
  };
  room.status = "ended";
  room.endedAt = new Date().toISOString();
  if (replaceLatest && replacementIndex >= 0) {
    room.reports[replacementIndex] = report;
  } else {
    room.reports.push(report);
  }
  return report;
}

function refreshLatestReport(room, options = {}) {
  if (!room.reports.length) return buildReport(room, options);
  return buildReport(room, { ...options, replaceLatest: true });
}

function buildAgentReport(room, agent) {
  const messages = room.messages.filter((message) => message.agentId === agent.id);
  const decisions = room.decisions.filter((decision) => decision.agentId === agent.id);
  const feedback = room.feedback.filter((entry) =>
    messages.some((message) => message.id === entry.messageId),
  );
  const tagCounts = countBy(feedback, "tag");
  const positiveCount = feedback.filter((entry) => entry.sentiment === "positive").length;
  const negativeCount = feedback.filter((entry) => entry.sentiment === "negative").length;
  const speakCount = decisions.filter((decision) => decision.decision === "speak").length;
  const staySilentCount = decisions.filter((decision) => decision.decision === "stay_silent").length;
  const waitCount = decisions.filter((decision) => decision.decision === "wait").length;
  const averageWords = average(messages.map((message) => countWords(message.content)));
  const interruptionCount = messages.filter((message) => wasLikelyInterruption(room, message)).length;
  const shouldStayQuietCount = tagCounts.should_have_stayed_quiet || 0;
  const helpedDecideCount = (tagCounts.helped_us_decide || 0) + (tagCounts.asked_useful_question || 0);
  const messageCount = messages.length || 1;
  const feedbackCount = feedback.length || 1;
  const routingSelectedCount = decisions.filter(
    (decision) => decision.route && decision.route.selectedAgentId === agent.id,
  ).length;
  const humanMessageWindow = countHumanMessagesAroundAiMessages(room, messages);

  const stats = {
    totalMessages: messages.length,
    averageMessageWords: round(averageWords),
    averageMessagesPerMinute: round(messages.length / sessionMinutes(room.messages)),
    averageResponseLatencyMs: round(average(messages.map((message) => message.latencyMs || 0))),
    speakDecisions: speakCount,
    staySilentDecisions: staySilentCount,
    waitDecisions: waitCount,
    speakStaySilentRatio: round(speakCount / Math.max(1, staySilentCount)),
    routingSelectedCount,
    routingSuccessRate: calculateRoutingSuccessRate(messages),
    positiveFeedbackRate: round(positiveCount / feedbackCount),
    negativeFeedbackRate: round(negativeCount / feedbackCount),
    interruptionRate: round((interruptionCount + (tagCounts.interrupted_humans || 0)) / messageCount),
    decisionHelpfulnessRate: round(helpedDecideCount / messageCount),
    shouldHaveStayedQuietRate: round(shouldStayQuietCount / messageCount),
    humanReplyRate: round(countHumanRepliesAfter(room, messages) / messageCount),
    humanMessagesBeforeAiMessages: humanMessageWindow.before,
    humanMessagesAfterAiMessages: humanMessageWindow.after,
    feedbackTagCounts: tagCounts,
  };

  const scorecard = buildScorecard(stats, tagCounts, messages.length);
  const bestMessages = pickMessages(room.messages, messages, "positive");
  const worstMessages = pickMessages(room.messages, messages, "negative");

  return {
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    version: agent.version,
    modelName: agent.modelName,
    promptVersion: agent.promptVersion,
    policyVersion: effectiveAgentPolicyVersion(agent, room),
    policyMode: room.policyMode,
    summary: summarizeAgent(agent, stats, scorecard),
    scorecard,
    stats,
    routingScores: buildAgentRoutingScores(agent, scorecard, stats, room),
    failureModes: inferFailureModes(stats, tagCounts),
    bestMessages,
    worstMessages,
    policyDiff: {
      before: effectiveAgentPolicyText(agent, room),
      after: generateImprovedPolicy(agent, stats, tagCounts, room),
      rationale: inferPolicyRationale(stats, tagCounts),
    },
    routingRecommendation: buildRoutingRecommendation(agent, scorecard, room),
  };
}

function buildScorecard(stats, tagCounts, rawMessageCount) {
  const hasMessages = rawMessageCount > 0;
  return {
    helpfulness: boundedScore(
      3 +
        stats.decisionHelpfulnessRate * 3 +
        (tagCounts.helpful || 0) +
        (tagCounts.asked_useful_question || 0) -
        stats.negativeFeedbackRate,
    ),
    timing: boundedScore(
      3 +
        (tagCounts.good_timing || 0) +
        (tagCounts.revived_dead_chat || 0) +
        (tagCounts.reduced_tension || 0) -
        (tagCounts.should_have_stayed_quiet || 0) -
        (tagCounts.interrupted_humans || 0) -
        (tagCounts.responded_too_late || 0) -
        (tagCounts.responded_too_often || 0),
    ),
    brevity: hasMessages ? boundedScore(6 - stats.averageMessageWords / 10) : 3,
    personalityConsistency: boundedScore(
      4 +
        (tagCounts.stayed_in_character || 0) +
        (tagCounts.matched_group_vibe || 0) -
        (tagCounts.wrong_vibe || 0) -
        (tagCounts.out_of_character || 0) -
        (tagCounts.broke_character || 0) -
        (tagCounts.too_assistant_like || 0) -
        (tagCounts.too_generic || 0),
    ),
    socialAwareness: boundedScore(
      3 +
        (tagCounts.good_read || 0) +
        (tagCounts.reduced_tension || 0) -
        (tagCounts.wrong_vibe || 0) -
        (tagCounts.misread_room || 0) -
        (tagCounts.ignored_quiet_person || 0) -
        (tagCounts.responded_wrong_person || 0) -
        (tagCounts.missed_social_tension || 0) -
        (tagCounts.escalated_tension || 0),
    ),
    groupMomentum: boundedScore(
      3 +
        (tagCounts.helped_us_decide || 0) +
        (tagCounts.created_momentum || 0) +
        (tagCounts.revived_dead_chat || 0) +
        (tagCounts.made_chat_fun || 0) -
        (tagCounts.killed_momentum || 0) -
        (tagCounts.made_chat_less_human || 0) -
        stats.interruptionRate * 2,
    ),
    decisionImpact: boundedScore(2 + stats.decisionHelpfulnessRate * 4),
    humanLikeness: boundedScore(
      4 -
        (tagCounts.too_verbose || 0) -
        (tagCounts.too_assistant_like || 0) -
        (tagCounts.too_generic || 0) -
        (tagCounts.made_chat_less_human || 0) -
        stats.shouldHaveStayedQuietRate,
    ),
    fun: boundedScore(
      2 +
        (tagCounts.funny || 0) +
        (tagCounts.made_chat_fun || 0) -
        (tagCounts.boring || 0) +
        (tagCounts.wrong_vibe ? -1 : 0),
    ),
    restraint: boundedScore(4 - stats.shouldHaveStayedQuietRate * 3 - stats.interruptionRate),
  };
}

function pickMessages(transcript, agentMessages, sentiment) {
  return agentMessages
    .map((message) => ({
      messageId: message.id,
      text: message.content,
      feedbackTags: message.feedback
        .filter((entry) => entry.sentiment === sentiment)
        .map((entry) => entry.tag),
      surroundingContext: contextAroundMessage(transcript, message.id),
      why:
        sentiment === "positive"
          ? "Feedback indicates this message improved timing, usefulness, or social energy."
          : "Feedback indicates this message hurt timing, brevity, or the room vibe.",
      whatShouldHaveDoneInstead:
        sentiment === "negative"
          ? suggestedAlternativeForMessage(message)
          : null,
    }))
    .filter((entry) => entry.feedbackTags.length > 0)
    .slice(0, 3);
}

function suggestedAlternativeForMessage(message) {
  const tags = message.feedback.map((entry) => entry.tag);
  if (tags.some((tag) => ["should_have_stayed_quiet", "interrupted_humans", "responded_too_often"].includes(tag))) {
    return "Stay silent and let the human exchange continue.";
  }
  if (tags.some((tag) => ["too_verbose", "repeated_obvious_info"].includes(tag))) {
    return "Use one short question or concrete next step instead of summarizing.";
  }
  if (tags.some((tag) => ["wrong_vibe", "wrong_tone", "misread_room", "responded_wrong_person"].includes(tag))) {
    return "Read the room more carefully and target the person or tension that actually needs help.";
  }
  if (tags.some((tag) => ["out_of_character", "broke_character", "too_assistant_like", "too_generic"].includes(tag))) {
    return "Preserve the agent personality and avoid generic assistant phrasing.";
  }
  if (tags.some((tag) => ["missed_social_tension", "escalated_tension"].includes(tag))) {
    return "Name the tension lightly or defer instead of escalating.";
  }
  return "Intervene less and make the next message shorter, more targeted, and more socially aware.";
}

function inferFailureModes(stats, tagCounts) {
  const modes = [];
  if (stats.shouldHaveStayedQuietRate > 0.2) modes.push("Over-participation");
  if (
    stats.interruptionRate > 0.25 ||
    tagCounts.interrupted_humans ||
    tagCounts.responded_too_late ||
    tagCounts.responded_too_often
  ) modes.push("Bad timing");
  if (tagCounts.too_verbose || tagCounts.repeated_obvious_info) modes.push("Too verbose");
  if (tagCounts.wrong_vibe || tagCounts.wrong_tone || tagCounts.misread_room) modes.push("Wrong vibe");
  if (tagCounts.ignored_quiet_person) modes.push("Ignored quiet participant");
  if (tagCounts.too_assistant_like || tagCounts.too_generic) modes.push("Generic assistant voice");
  if (tagCounts.out_of_character || tagCounts.broke_character) modes.push("Personality drift");
  if (tagCounts.missed_social_tension || tagCounts.escalated_tension) modes.push("Missed social tension");
  if (tagCounts.killed_momentum || tagCounts.made_chat_less_human) modes.push("Killed momentum");
  if (stats.decisionHelpfulnessRate < 0.2) modes.push("Low decision impact");
  return modes.length ? modes : ["No dominant failure mode detected yet"];
}

function inferPolicyRationale(stats, tagCounts) {
  if (stats.shouldHaveStayedQuietRate > 0.2 || tagCounts.interrupted_humans || tagCounts.responded_too_often) {
    return "Human feedback shows timing risk, so the next policy raises the speak threshold and adds restraint.";
  }
  if (tagCounts.too_verbose || tagCounts.repeated_obvious_info) {
    return "The next policy keeps messages shorter and favors direct questions over summaries.";
  }
  if (tagCounts.ignored_quiet_person || tagCounts.responded_wrong_person) {
    return "The next policy pays more attention to who has not been included.";
  }
  if (tagCounts.too_assistant_like || tagCounts.too_generic || tagCounts.out_of_character) {
    return "The next policy preserves the agent's social role and avoids generic assistant phrasing.";
  }
  if (stats.decisionHelpfulnessRate > 0.3) {
    return "The next policy preserves decision-oriented behavior while reducing unnecessary turns.";
  }
  return "The next policy makes participation more selective and measurable.";
}

function generateImprovedPolicy(agent, stats, tagCounts, room) {
  const base =
    room.policyMode === "improved" && room.activePolicyOverrides[agent.id]
      ? room.activePolicyOverrides[agent.id]
      : agent.improvedPolicy;
  const clauses = [base];

  if (stats.shouldHaveStayedQuietRate > 0.2 || tagCounts.interrupted_humans || tagCounts.responded_too_often) {
    clauses.push("Raise the speak threshold when two or more humans are actively exchanging messages.");
  }
  if (tagCounts.too_verbose || tagCounts.repeated_obvious_info) {
    clauses.push("Keep interventions to one short message and avoid restating obvious context.");
  }
  if (tagCounts.ignored_quiet_person || tagCounts.responded_wrong_person) {
    clauses.push("Before speaking, identify who has been least heard and whether the message should target them.");
  }
  if (tagCounts.missed_social_tension || tagCounts.escalated_tension) {
    clauses.push("When tension is present, name the unresolved constraint lightly instead of adding options.");
  }
  if (tagCounts.too_assistant_like || tagCounts.too_generic || tagCounts.out_of_character) {
    clauses.push("Use the agent's social voice and avoid generic assistant framing.");
  }
  if (stats.decisionHelpfulnessRate > 0.3 || tagCounts.asked_useful_question) {
    clauses.push("Preserve concise decision-forcing questions when the room is choosing between options.");
  }
  if (room.sessionFeedback.some((entry) => entry.routeNextAgentId === agent.id)) {
    clauses.push("Prefer this Shape for similar rooms when its last intervention received positive routing feedback.");
  }

  return [...new Set(clauses)].join(" ");
}

function summarizeAgent(agent, stats, scorecard) {
  if (!stats.totalMessages) {
    return `${agent.name} did not speak in this session. Its restraint was high, but usefulness cannot be judged yet.`;
  }
  if (scorecard.timing < 3) {
    return `${agent.name} contributed ${stats.totalMessages} message(s), but timing feedback suggests it should speak less often.`;
  }
  if (scorecard.decisionImpact >= 4) {
    return `${agent.name} helped move the room toward a decision while keeping participation measurable.`;
  }
  return `${agent.name} participated ${stats.totalMessages} time(s); more feedback is needed to prove consistent value.`;
}

function summarizeSession(agentReports, room) {
  const best = [...agentReports].sort(
    (a, b) => b.scorecard.groupMomentum + b.scorecard.timing - (a.scorecard.groupMomentum + a.scorecard.timing),
  )[0];
  const modeLabel = room.policyMode === "improved" ? "improved policy" : "baseline policy";
  return `This ${modeLabel} run measured agent timing, human feedback, and routing fit in a ${room.scenario.roomType} room. ${best.agentName} currently has the strongest routing case.`;
}

function summarizeSessionFeedback(room) {
  const entries = room.sessionFeedback;
  const total = entries.length || 1;
  return {
    totalResponses: entries.length,
    didReachDecisionRate: round(entries.filter((entry) => entry.didReachDecision).length / total),
    wouldInviteAgainRate: round(entries.filter((entry) => entry.wouldInviteAgain).length / total),
    humansTalkedMoreOrLess: countBy(entries, "humansTalkedMoreOrLess"),
    mostUsefulAgentCounts: countBy(entries.filter((entry) => entry.mostUsefulAgentId), "mostUsefulAgentId"),
    mostAnnoyingAgentCounts: countBy(entries.filter((entry) => entry.mostAnnoyingAgentId), "mostAnnoyingAgentId"),
    routeNextAgentCounts: countBy(entries.filter((entry) => entry.routeNextAgentId), "routeNextAgentId"),
    notes: entries.map((entry) => entry.freeformNotes).filter(Boolean).slice(0, 3),
  };
}

function buildRoomStats(room) {
  const humanMessages = room.messages.filter((message) => message.senderType === "human");
  const aiMessages = room.messages.filter((message) => message.senderType === "ai");
  return {
    totalMessages: room.messages.length,
    humanMessages: humanMessages.length,
    aiMessages: aiMessages.length,
    aiMessageShare: round(aiMessages.length / (room.messages.length || 1)),
    feedbackTags: room.feedback.length,
    activeParticipants: unique(humanMessages.map((message) => message.senderName)).length,
    routingDecisions: room.routingDecisions.length,
    reportJobs: room.reportJobs.length,
    groupState: room.currentGroupState,
  };
}

function buildSystemPerformance(room, systemContext = {}) {
  const aiMessages = room.messages.filter((message) => message.senderType === "ai");
  const fullLatencies = aiMessages.map((message) => message.latencyMs || 0);
  const firstTokenLatencies = aiMessages.map((message) => message.firstTokenLatencyMs || message.latencyMs || 0);
  const completedReportJobs = room.reportJobs.filter((job) => job.status === "completed");
  const latestReportJob = completedReportJobs[completedReportJobs.length - 1] || null;
  const metrics = hydrateRuntimeMetrics(room.runtimeMetrics);
  const queueDepths = room.reportJobs.map((job) => Number(job.queueDepthAtEnqueue || 0));
  const totalLlmCalls = Math.max(1, room.decisions.length + aiMessages.length + room.reportJobs.length);
  const totalConnections = Math.max(1, metrics.websocketConnections);
  const activeRooms =
    systemContext.activeRooms === undefined ? 1 : Math.max(0, Number(systemContext.activeRooms || 0));
  const roomsTracked =
    systemContext.roomsTracked === undefined
      ? Math.max(1, activeRooms)
      : Math.max(0, Number(systemContext.roomsTracked || 0));
  return {
    websocketConnectionsTracked: room.participants.size,
    websocketConnectionsTotal: metrics.websocketConnections,
    websocketDisconnects: metrics.websocketDisconnects,
    reconnectRate: round(metrics.websocketDisconnects / totalConnections),
    activeRooms,
    roomsTracked,
    messagesPerSecond: estimateMessagesPerSecond(room.messages),
    p50FanoutLatencyMs: round(percentile(metrics.fanoutLatenciesMs, 0.5)),
    p95FanoutLatencyMs: round(percentile(metrics.fanoutLatenciesMs, 0.95)),
    p99FanoutLatencyMs: round(percentile(metrics.fanoutLatenciesMs, 0.99)),
    p50FirstTokenLatencyMs: round(percentile(firstTokenLatencies, 0.5)),
    p95FirstTokenLatencyMs: round(percentile(firstTokenLatencies, 0.95)),
    p99FirstTokenLatencyMs: round(percentile(firstTokenLatencies, 0.99)),
    p50FullResponseLatencyMs: round(percentile(fullLatencies, 0.5)),
    p95FullResponseLatencyMs: round(percentile(fullLatencies, 0.95)),
    p99FullResponseLatencyMs: round(percentile(fullLatencies, 0.99)),
    llmErrorRate: round(metrics.llmErrors / totalLlmCalls),
    timeoutRate: round(metrics.timeouts / totalLlmCalls),
    queueDepth: room.reportJobs.filter((job) => ["queued", "processing"].includes(job.status)).length,
    maxReportQueueDepth: queueDepths.length ? Math.max(...queueDepths) : 0,
    feedbackWriteLatencyMs: round(percentile(metrics.feedbackWriteLatenciesMs, 0.95)),
    reportGenerationLatencyMs: latestReportJob ? latestReportJob.latencyMs : 0,
    reportGeneratedLocally: true,
  };
}

function compareReports(previousReport, currentAgentReports) {
  return currentAgentReports
    .map((current) => {
      const previous = previousReport.agents.find((agent) => agent.agentId === current.agentId);
      if (!previous) return null;
      const baseline = comparisonSnapshot(previous);
      const improved = comparisonSnapshot(current);
      return {
        agentId: current.agentId,
        agentName: current.agentName,
        baseline,
        improved,
        messageDelta: current.stats.totalMessages - previous.stats.totalMessages,
        shouldStayQuietDelta:
          current.stats.shouldHaveStayedQuietRate - previous.stats.shouldHaveStayedQuietRate,
        helpedDecideDelta:
          current.stats.decisionHelpfulnessRate - previous.stats.decisionHelpfulnessRate,
        timingScoreDelta: current.scorecard.timing - previous.scorecard.timing,
        restraintScoreDelta: current.scorecard.restraint - previous.scorecard.restraint,
      };
    })
    .filter(Boolean);
}

function comparisonSnapshot(agentReport) {
  return {
    policyMode: agentReport.policyMode || null,
    totalMessages: agentReport.stats.totalMessages,
    shouldHaveStayedQuietTags: agentReport.stats.feedbackTagCounts.should_have_stayed_quiet || 0,
    tooVerboseTags: agentReport.stats.feedbackTagCounts.too_verbose || 0,
    helpedDecideTags: agentReport.stats.feedbackTagCounts.helped_us_decide || 0,
    interruptedHumansTags: agentReport.stats.feedbackTagCounts.interrupted_humans || 0,
    timingScore: agentReport.scorecard.timing,
    restraintScore: agentReport.scorecard.restraint,
    decisionImpactScore: agentReport.scorecard.decisionImpact,
    decisionHelpfulnessRate: agentReport.stats.decisionHelpfulnessRate,
    routingSuccessRate: agentReport.stats.routingSuccessRate,
  };
}

function extractSignals(room, triggerMessage) {
  const text = String(triggerMessage.content || "").toLowerCase();
  const recent = room.messages.slice(-6);
  const recentHuman = recent.filter((message) => message.senderType === "human");
  const activeHumanExchange =
    recent.slice(-2).length === 2 && recent.slice(-2).every((message) => message.senderType === "human");
  const allRecentText = recent.map((message) => message.content.toLowerCase()).join(" ");
  const combined = `${allRecentText} ${text}`;
  const constraints = [];

  if (/(cheap|budget|cost|expensive|money|scope|priority)/.test(combined)) constraints.push("budget");
  if (/(nightlife|bar|club|downtown|dance|drinks|fun)/.test(combined)) constraints.push("nightlife");
  if (/(nature|hike|trail|trees|lake|cabin|outdoors|quality|polished)/.test(combined)) constraints.push("nature");
  if (/(spicy|food|dinner|heard|listen|ignored)/.test(combined)) constraints.push("social_fit");
  if (/(decide|pick|choose|vote|option|plan|where|what should|rank|ship)/.test(combined)) {
    constraints.push("decision");
  }

  const decisionNeeded = /(decide|pick|choose|vote|option|plan|where|what should|rank|ship)/.test(
    combined,
  );
  const tension = /(annoying|hate|no way|can't|stressed|argue|ignored|frustrated|nobody is listening|messy)/.test(combined);
  const playful = /(lol|haha|meme|chaos|wild|funny|vibe|party|main character)/.test(combined);
  const derailed = /(pizza|meme|random|whatever|side quest|off topic)/.test(combined);
  const confusion = /(not sure|confused|unclear|what.*priority|what matters)/.test(combined);
  const lowEnergy = recentHuman.length >= 2 && !decisionNeeded && !playful && !tension;
  const quietParticipantName = detectQuietParticipant(room);
  const quietParticipantRisk = Boolean(quietParticipantName);

  let groupState = "active";
  if (tension) groupState = "tense";
  else if (decisionNeeded) groupState = "decision_needed";
  else if (playful) groupState = "playful";
  else if (activeHumanExchange) groupState = "high_human_momentum";
  else if (lowEnergy) groupState = "low_human_momentum";

  return {
    activeHumanExchange,
    constraints: [...new Set(constraints)],
    decisionNeeded,
    tension,
    playful,
    derailed,
    confusion,
    lowEnergy,
    quietParticipantRisk,
    quietParticipantName,
    humanCount: recentHuman.length,
    groupState,
  };
}

function detectQuietParticipantRisk(room) {
  return Boolean(detectQuietParticipant(room));
}

function detectQuietParticipant(room) {
  const humanMessages = room.messages.filter((message) => message.senderType === "human");
  const participantNames = [...room.participants.values()]
    .filter((participant) => participant.participantType === "human")
    .map((participant) => participant.displayName);
  const names = [...new Set([...participantNames, ...humanMessages.map((message) => message.senderName)])];
  if (names.length < 3) return null;

  const speakers = countBy(humanMessages, "senderName");
  const entries = names.map((name) => [name, speakers[name] || 0]);
  const counts = entries.map(([, count]) => count);
  if (Math.max(...counts) < 3 || Math.min(...counts) > 1) return null;

  entries.sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  return entries[0][0];
}

function targetUserForDecision(agent, signals, triggerMessage) {
  if (agent.id === "observer_v1" && signals.quietParticipantName) {
    return signals.quietParticipantName;
  }
  return inferTargetUser(triggerMessage);
}

function wasLikelyInterruption(room, aiMessage) {
  const index = room.messages.findIndex((message) => message.id === aiMessage.id);
  if (index < 2) return false;
  const previousTwo = room.messages.slice(index - 2, index);
  return previousTwo.every((message) => message.senderType === "human");
}

function countHumanRepliesAfter(room, aiMessages) {
  return aiMessages.reduce((sum, message) => {
    const index = room.messages.findIndex((candidate) => candidate.id === message.id);
    const nextTwo = room.messages.slice(index + 1, index + 3);
    return sum + (nextTwo.some((candidate) => candidate.senderType === "human") ? 1 : 0);
  }, 0);
}

function countHumanMessagesAroundAiMessages(room, aiMessages) {
  return aiMessages.reduce(
    (totals, message) => {
      const index = room.messages.findIndex((candidate) => candidate.id === message.id);
      if (index === -1) return totals;
      totals.before += room.messages
        .slice(Math.max(0, index - 3), index)
        .filter((candidate) => candidate.senderType === "human").length;
      totals.after += room.messages
        .slice(index + 1, index + 4)
        .filter((candidate) => candidate.senderType === "human").length;
      return totals;
    },
    { before: 0, after: 0 },
  );
}

function calculateRoutingSuccessRate(messages) {
  const routedMessages = messages.filter((message) => message.decisionId);
  if (!routedMessages.length) return 0;
  const successful = routedMessages.filter((message) => {
    const positive = message.feedback.filter((entry) => entry.sentiment === "positive").length;
    const negative = message.feedback.filter((entry) => entry.sentiment === "negative").length;
    return positive > negative || (!negative && positive > 0);
  }).length;
  return round(successful / routedMessages.length);
}

function sessionMinutes(messages) {
  if (messages.length < 2) return 1;
  const first = Date.parse(messages[0].createdAt);
  const last = Date.parse(messages[messages.length - 1].createdAt);
  return Math.max(1, (last - first) / 60000);
}

function contextAroundMessage(messages, messageId) {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return [];
  return messages.slice(Math.max(0, index - 1), index + 2).map((message) => ({
    senderName: message.senderName,
    senderType: message.senderType,
    content: message.content,
  }));
}

function buildRoutingRecommendation(agent, scorecard, room) {
  const routeNextVotes = room.sessionFeedback.filter((entry) => entry.routeNextAgentId === agent.id).length;
  const mostUsefulVotes = room.sessionFeedback.filter((entry) => entry.mostUsefulAgentId === agent.id).length;
  const mostAnnoyingVotes = room.sessionFeedback.filter((entry) => entry.mostAnnoyingAgentId === agent.id).length;
  const baseRouteNextTime = scorecard.timing >= 3 && scorecard.groupMomentum >= 3;
  const positiveVotes = routeNextVotes + mostUsefulVotes;
  const routeNextTime =
    routeNextVotes > mostAnnoyingVotes ||
    (baseRouteNextTime && mostAnnoyingVotes <= positiveVotes);
  const baseReason =
    agent.id === "mediator_v1"
      ? "Best fit when a group needs to make a decision without losing social context."
      : agent.id === "vibe_friend_v1"
        ? "Best fit when the room needs warmth and energy, but only with stricter timing."
        : "Best fit when tension, silence, or ignored constraints matter more than entertainment.";

  return {
    agent: agent.name,
    recommendedFor: agent.routingFit,
    avoidFor:
      agent.id === "mediator_v1"
        ? ["fast joking conversations", "rooms with high human momentum"]
        : agent.id === "vibe_friend_v1"
          ? ["tense rooms", "decision-heavy rooms"]
          : ["rooms that are already flowing", "purely playful rooms"],
    routeNextTime,
    reason: buildRoutingRecommendationReason(baseReason, {
      routeNextVotes,
      mostUsefulVotes,
      mostAnnoyingVotes,
    }),
    sessionFeedback: {
      routeNextVotes,
      mostUsefulVotes,
      mostAnnoyingVotes,
    },
  };
}

function buildRoutingRecommendationReason(baseReason, feedbackVotes) {
  const notes = [];
  if (feedbackVotes.routeNextVotes > 0) {
    notes.push(`${feedbackVotes.routeNextVotes} session feedback vote(s) explicitly routed this Shape into similar rooms.`);
  }
  if (feedbackVotes.mostUsefulVotes > 0) {
    notes.push(`${feedbackVotes.mostUsefulVotes} user(s) marked it most useful.`);
  }
  if (feedbackVotes.mostAnnoyingVotes > feedbackVotes.routeNextVotes + feedbackVotes.mostUsefulVotes) {
    notes.push(`${feedbackVotes.mostAnnoyingVotes} user(s) marked it most annoying, so route cautiously.`);
  }
  return [baseReason, ...notes].join(" ");
}

function buildAgentRoutingScores(agent, scorecard, stats, room) {
  const roomFitBonus =
    (room.scenario.roomType === "planning" && agent.id === "mediator_v1") ||
    (room.scenario.roomType === "drama_conflict" && agent.id === "observer_v1") ||
    (room.currentGroupState === "playful" && agent.id === "vibe_friend_v1")
      ? 0.12
      : 0;
  return {
    agentId: agent.id,
    planningScore: boundedProbability(
      (agent.id === "mediator_v1" ? 0.48 : 0.24) +
        scorecard.decisionImpact / 10 +
        stats.routingSuccessRate / 4 +
        roomFitBonus,
    ),
    conflictScore: boundedProbability(
      (agent.id === "observer_v1" ? 0.46 : agent.id === "mediator_v1" ? 0.34 : 0.14) +
        scorecard.socialAwareness / 10 +
        roomFitBonus,
    ),
    funScore: boundedProbability(
      (agent.id === "vibe_friend_v1" ? 0.5 : 0.18) + scorecard.fun / 10 - stats.negativeFeedbackRate / 5,
    ),
    restraintScore: boundedProbability(scorecard.restraint / 5 - stats.shouldHaveStayedQuietRate / 3),
    personalityConsistency: boundedProbability(scorecard.personalityConsistency / 5),
    routingSuccessScore: boundedProbability(stats.routingSuccessRate),
  };
}

function createExport(room) {
  const serialized = serializeRoom(room);
  return {
    exportedAt: new Date().toISOString(),
    room: serialized,
    transcript: serialized.messages.map((message) => ({
      id: message.id,
      senderName: message.senderName,
      senderType: message.senderType,
      agentId: message.agentId,
      content: message.content,
      createdAt: message.createdAt,
      feedbackTags: message.feedback.map((entry) => entry.tag),
    })),
  };
}

function inferTargetUser(triggerMessage) {
  return triggerMessage.senderType === "human" ? triggerMessage.senderName : null;
}

function getAgent(agentId) {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

function getRoomAgents(room) {
  return room.selectedAgentIds.map(getAgent);
}

function getScenario(scenarioId) {
  return scenarios.find((candidate) => candidate.id === scenarioId) || scenarios[0];
}

function normalizeAgentIds(agentIds) {
  const requested = Array.isArray(agentIds) && agentIds.length ? agentIds : agents.map((agent) => agent.id);
  const valid = [...new Set(requested.filter((agentId) => agents.some((agent) => agent.id === agentId)))];
  const selected = valid.length ? valid : agents.map((agent) => agent.id);

  for (const agent of agents) {
    if (selected.length >= agentSelectionRules.min) break;
    if (!selected.includes(agent.id)) selected.push(agent.id);
  }

  return selected.slice(0, agentSelectionRules.max);
}

function normalizeOptionalAgentId(agentId) {
  if (!agentId) return null;
  return agents.some((agent) => agent.id === agentId) ? agentId : null;
}

function normalizeTalkedMoreLess(value) {
  return ["more", "less", "same", "unsure"].includes(value) ? value : "unsure";
}

function baseConfidence(agentId) {
  if (agentId === "mediator_v1") return 0.24;
  if (agentId === "vibe_friend_v1") return 0.2;
  return 0.16;
}

function thresholdFor(agentId, improved) {
  if (agentId === "mediator_v1") return improved ? 0.68 : 0.42;
  if (agentId === "vibe_friend_v1") return improved ? 0.74 : 0.38;
  return improved ? 0.66 : 0.5;
}

function effectiveAgentPolicyVersion(agent, room) {
  return room.policyMode === "improved"
    ? agent.policyVersion.replace("baseline", "improved")
    : agent.policyVersion;
}

function effectiveAgentPolicyText(agent, room) {
  if (room.policyMode === "improved") {
    return room.activePolicyOverrides[agent.id] || agent.improvedPolicy;
  }
  return agent.baselinePolicy;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    if (!value) return acc;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

function estimateMessagesPerSecond(messages) {
  if (messages.length < 2) return messages.length;
  const first = Date.parse(messages[0].createdAt);
  const last = Date.parse(messages[messages.length - 1].createdAt);
  const seconds = Math.max(1, (last - first) / 1000);
  return round(messages.length / seconds);
}

function unique(values) {
  return [...new Set(values)];
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function boundedScore(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function boundedProbability(value) {
  return round(Math.max(0, Math.min(1, value)));
}

function serializeRoom(room) {
  return {
    id: room.id,
    scenario: room.scenario,
    scenarios,
    status: room.status,
    policyMode: room.policyMode,
    currentPolicyVersion: room.currentPolicyVersion,
    routerVersion: room.routerVersion,
    sessionNumber: room.sessionNumber,
    createdAt: room.createdAt,
    endedAt: room.endedAt,
    participants: [...room.participants.values()],
    agents: getRoomAgents(room),
    availableAgents: agents,
    selectedAgentIds: room.selectedAgentIds,
    agentSelectionRules,
    feedbackDefinitions,
    messages: room.messages,
    decisions: room.decisions,
    routingDecisions: room.routingDecisions,
    reportJobs: room.reportJobs,
    feedback: room.feedback,
    sessionFeedback: room.sessionFeedback,
    reports: room.reports,
    currentGroupState: room.currentGroupState,
    runtimeMetrics: room.runtimeMetrics,
    activePolicyOverrides: room.activePolicyOverrides,
  };
}

module.exports = {
  agents,
  agentSelectionRules,
  feedbackDefinitions,
  scenario: getScenario(defaultScenarioId),
  scenarios,
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
  evaluateAndRouteAgents,
  finalizeAgentMessage,
  generateAgentReply,
  getRoomAgents,
  getScenario,
  hydrateRoom,
  refreshLatestReport,
  recordRoutedDecisions,
  resetRoomForNextRun,
  routeAgentDecisions,
  serializeRoom,
  setRoomConfig,
};
