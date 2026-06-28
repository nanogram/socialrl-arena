const assert = require("assert");
const {
  addFeedback,
  addHumanMessage,
  addParticipant,
  addSessionFeedback,
  agentSelectionRules,
  buildReport,
  createAgentPlaceholder,
  createExport,
  createRoom,
  evaluateAndRouteAgents,
  finalizeAgentMessage,
  generateAgentReply,
  getRoomAgents,
  createAgentDecisions,
  refreshLatestReport,
  resetRoomForNextRun,
  routeAgentDecisions,
  setRoomConfig,
} = require("../src/core");
const { buildAgentDecisionPrompt, buildRouterPrompt } = require("../src/prompts");

function runAgentTurn(room, displayName, content) {
  const humanMessage = addHumanMessage(room, displayName, content);
  const decisions = evaluateAndRouteAgents(room, humanMessage);
  const speaker = decisions.find((decision) => decision.decision === "speak");
  if (!speaker) return null;
  const reply = generateAgentReply(room, speaker);
  const aiMessage = createAgentPlaceholder(room, speaker.agentId, speaker.id);
  finalizeAgentMessage(aiMessage, reply, 250);
  return { aiMessage, decisions };
}

function makeDecision(room, triggerMessage, agentId, input = {}) {
  const names = {
    mediator_v1: "Mediator",
    vibe_friend_v1: "Vibe Friend",
    observer_v1: "Observer",
  };
  return {
    id: `${agentId}-${input.id || "decision"}`,
    roomId: room.id,
    triggerMessageId: triggerMessage.id,
    agentId,
    agentName: names[agentId],
    decision: input.decision || "speak",
    targetUser: null,
    reason: input.reason || "test route candidate",
    confidence: input.confidence === undefined ? 0.7 : input.confidence,
    groupState: input.groupState || "active",
    roomType: room.scenario.roomType,
    modelName: "test-model",
    promptVersion: "test-prompt",
    policyVersion: "test-policy",
    createdAt: new Date().toISOString(),
  };
}

const room = createRoom("test-room");
assert.equal(getRoomAgents(room).length, 3, "default room should include three spec agents");
assert.deepEqual(agentSelectionRules, { min: 2, max: 3 });

const singleAgentRoom = createRoom("single-agent-request", {
  agentIds: ["observer_v1"],
});
assert.equal(singleAgentRoom.selectedAgentIds.length, 2, "rooms should enforce the two-Shape minimum");
assert.ok(singleAgentRoom.selectedAgentIds.includes("observer_v1"));

const tooManyAgentsRoom = createRoom("too-many-agent-request", {
  agentIds: ["observer_v1", "mediator_v1", "vibe_friend_v1", "unknown_agent"],
});
assert.equal(tooManyAgentsRoom.selectedAgentIds.length, 3, "rooms should cap selected Shapes at three");

const baselineTurns = [
  runAgentTurn(room, "Alex", "I need this to stay cheap."),
  runAgentTurn(room, "Jules", "I want nightlife and somewhere fun."),
  runAgentTurn(room, "Sam", "Can we pick between a cheap city weekend or a cabin near trails?"),
].filter(Boolean);
const aiMessages = baselineTurns.map((turn) => turn.aiMessage);

assert.ok(aiMessages.length >= 1, "at least one agent should speak during a planning room");
assert.ok(
  baselineTurns.some((turn) => turn.decisions.every((decision) => decision.route)),
  "agent decisions should include route metadata",
);
assert.ok(room.routingDecisions.length >= 1, "router decisions should be recorded separately");
assert.ok(
  room.decisions.every((decision) => decision.route && decision.route.routingDecisionId),
  "each decision should point back to a routing decision",
);
assert.ok(
  room.decisions.every((decision) => decision.route && decision.route.routerModelName === "local-rule-router"),
  "each local route should expose the router model metadata",
);

addFeedback(room, aiMessages[0].id, "too_verbose", "test_user");
addFeedback(room, aiMessages[0].id, "should_have_stayed_quiet", "test_user");
addFeedback(room, aiMessages[0].id, "too_assistant_like", "test_user");
addSessionFeedback(
  room,
  {
    mostUsefulAgentId: "mediator_v1",
    mostAnnoyingAgentId: "vibe_friend_v1",
    routeNextAgentId: "observer_v1",
    didReachDecision: false,
    wouldInviteAgain: false,
    humansTalkedMoreOrLess: "same",
    freeformNotes: "Baseline spoke too early.",
  },
  "test_user",
);

const report = buildReport(room, { systemContext: { activeRooms: 4, roomsTracked: 9 } });
const mediatorReport = report.agents.find((agent) => agent.agentId === "mediator_v1");
const observerReport = report.agents.find((agent) => agent.agentId === "observer_v1");
const vibeReport = report.agents.find((agent) => agent.agentId === "vibe_friend_v1");

assert.equal(report.policyMode, "baseline");
assert.ok(report.summary.includes("baseline policy"));
assert.equal(report.sessionFeedbackSummary.totalResponses, 1);
assert.equal(report.sessionFeedbackSummary.routeNextAgentCounts.observer_v1, 1);
assert.equal(observerReport.routingRecommendation.sessionFeedback.routeNextVotes, 1);
assert.ok(observerReport.routingRecommendation.routeNextTime);
assert.ok(observerReport.routingRecommendation.reason.includes("session feedback"));
assert.equal(vibeReport.routingRecommendation.sessionFeedback.mostAnnoyingVotes, 1);
assert.equal(vibeReport.routingRecommendation.routeNextTime, false);
assert.ok(mediatorReport.policyDiff.after.includes("Speak only"));
assert.ok(
  mediatorReport.policyDiff.after.includes("Use the agent's social voice") ||
    mediatorReport.policyDiff.after.includes("Raise the speak threshold"),
  "policy diff should include feedback-specific guidance",
);
assert.ok(
  mediatorReport.failureModes.includes("Too verbose") ||
    mediatorReport.failureModes.includes("Over-participation") ||
    mediatorReport.failureModes.includes("Generic assistant voice"),
  "feedback should surface a concrete failure mode",
);
assert.ok(Number.isInteger(mediatorReport.scorecard.timing));
assert.ok(mediatorReport.worstMessages.every((message) => "whatShouldHaveDoneInstead" in message));
assert.ok(Number.isFinite(mediatorReport.stats.averageMessagesPerMinute));
assert.ok("routingSuccessRate" in mediatorReport.stats);
assert.ok(mediatorReport.routingScores.planningScore >= 0);
for (const key of [
  "activeRooms",
  "messagesPerSecond",
  "p50FanoutLatencyMs",
  "p95FanoutLatencyMs",
  "p99FanoutLatencyMs",
  "p50FirstTokenLatencyMs",
  "p95FirstTokenLatencyMs",
  "p99FirstTokenLatencyMs",
  "p50FullResponseLatencyMs",
  "p95FullResponseLatencyMs",
  "p99FullResponseLatencyMs",
  "llmErrorRate",
  "timeoutRate",
  "reconnectRate",
  "maxReportQueueDepth",
  "feedbackWriteLatencyMs",
  "reportGenerationLatencyMs",
]) {
  assert.ok(key in report.systemPerformance, `system performance should include ${key}`);
}
assert.ok(Number.isFinite(report.systemPerformance.messagesPerSecond));
assert.equal(report.systemPerformance.activeRooms, 4);
assert.equal(report.systemPerformance.roomsTracked, 9);
assert.ok(report.systemPerformance.reportGeneratedLocally);

addSessionFeedback(
  room,
  {
    mostUsefulAgentId: "observer_v1",
    routeNextAgentId: "mediator_v1",
    didReachDecision: true,
    wouldInviteAgain: true,
    humansTalkedMoreOrLess: "more",
    freeformNotes: "Late normal-mode feedback should refresh the report.",
  },
  "late_feedback_user",
);
const refreshedReport = refreshLatestReport(room);
assert.equal(room.reports.length, 1);
assert.equal(refreshedReport.id, report.id);
assert.equal(refreshedReport.sessionFeedbackSummary.totalResponses, 2);
assert.equal(refreshedReport.sessionFeedbackSummary.routeNextAgentCounts.mediator_v1, 1);

room.policyMode = "improved";
room.sessionNumber += 1;
room.messages = [];
room.decisions = [];
room.feedback = [];
room.sessionFeedback = [];

const improvedTurn = runAgentTurn(
  room,
  "Taylor",
  "What is the one constraint we should optimize for first: cost, nightlife, or nature?",
);

if (improvedTurn) {
  addFeedback(room, improvedTurn.aiMessage.id, "good_timing", "test_user");
  addFeedback(room, improvedTurn.aiMessage.id, "helped_us_decide", "test_user");
}

addSessionFeedback(
  room,
  {
    mostUsefulAgentId: "mediator_v1",
    didReachDecision: true,
    wouldInviteAgain: true,
    humansTalkedMoreOrLess: "more",
  },
  "test_user",
);

const improvedReport = buildReport(room);
assert.equal(improvedReport.policyMode, "improved");
assert.ok(Array.isArray(improvedReport.comparison));
assert.ok(improvedReport.comparison.every((item) => item.baseline && item.improved));
assert.ok(
  improvedReport.comparison.every((item) => Number.isFinite(item.baseline.totalMessages)),
  "comparison should include baseline side-by-side metrics",
);
room.activePolicyOverrides = { mediator_v1: improvedReport.agents[0].policyDiff.after };
room.currentPolicyVersion = `improved_from_${improvedReport.id.slice(0, 8)}`;
resetRoomForNextRun(room, "improved");
assert.ok(room.currentPolicyVersion.startsWith("improved_from_"));

setRoomConfig(room, {
  scenarioId: "friend_conflict",
  agentIds: ["observer_v1"],
});
assert.equal(room.selectedAgentIds.length, 2, "configuration should also enforce the two-Shape minimum");
assert.ok(room.selectedAgentIds.includes("observer_v1"));
room.messages = [];
room.decisions = [];
room.feedback = [];
const observerTurn = runAgentTurn(room, "Rae", "I feel ignored and nobody is listening.");
assert.ok(observerTurn, "observer should intervene in a tense room when selected");
assert.equal(observerTurn.aiMessage.agentId, "observer_v1");

const exported = createExport(room);
assert.equal(exported.room.id, "test-room");
assert.ok(Array.isArray(exported.transcript));
assert.ok(Array.isArray(exported.room.routingDecisions));

const promptRoom = createRoom("prompt-room");
const triggerMessage = addHumanMessage(promptRoom, "Alex", "Can we decide between cheap and fun?");
const rawDecisions = createAgentDecisions(promptRoom, triggerMessage);
const routedDecisions = routeAgentDecisions(promptRoom, triggerMessage, rawDecisions);
const decisionPrompt = buildAgentDecisionPrompt({ room: promptRoom, triggerMessage });
const routerPrompt = buildRouterPrompt({ room: promptRoom, triggerMessage, decisions: routedDecisions });
assert.equal(decisionPrompt.version, "agent_decision_prompt_v1");
assert.equal(routerPrompt.version, "router_prompt_v1");
assert.ok(decisionPrompt.user.includes("speak, stay_silent, or wait"));

const tenseRouteRoom = createRoom("tense-route", {
  scenarioId: "friend_conflict",
  agentIds: ["vibe_friend_v1", "observer_v1", "mediator_v1"],
});
const tenseTrigger = addHumanMessage(tenseRouteRoom, "Rae", "Nobody is listening and this is annoying.");
const tenseDecisions = routeAgentDecisions(tenseRouteRoom, tenseTrigger, [
  makeDecision(tenseRouteRoom, tenseTrigger, "vibe_friend_v1", {
    confidence: 0.95,
    groupState: "tense",
    id: "vibe-tense",
  }),
  makeDecision(tenseRouteRoom, tenseTrigger, "observer_v1", {
    confidence: 0.72,
    groupState: "tense",
    id: "observer-tense",
  }),
  makeDecision(tenseRouteRoom, tenseTrigger, "mediator_v1", {
    confidence: 0.65,
    groupState: "tense",
    id: "mediator-tense",
  }),
]);
const tenseRoute = tenseRouteRoom.routingDecisions.at(-1);
assert.equal(tenseRoute.selectedAgentId, "observer_v1");
assert.ok(tenseRoute.blockedAgentIds.includes("vibe_friend_v1"));
assert.equal(
  tenseDecisions.find((decision) => decision.agentId === "vibe_friend_v1").decision,
  "wait",
);

const playfulRouteRoom = createRoom("playful-route", {
  agentIds: ["vibe_friend_v1", "mediator_v1"],
});
addHumanMessage(playfulRouteRoom, "Alex", "lol this trip plan has main character energy");
const playfulTrigger = addHumanMessage(playfulRouteRoom, "Jules", "haha the chaos is honestly funny");
routeAgentDecisions(playfulRouteRoom, playfulTrigger, [
  makeDecision(playfulRouteRoom, playfulTrigger, "vibe_friend_v1", {
    confidence: 0.7,
    groupState: "playful",
    id: "vibe-playful",
  }),
  makeDecision(playfulRouteRoom, playfulTrigger, "mediator_v1", {
    confidence: 0.5,
    groupState: "playful",
    id: "mediator-playful",
  }),
]);
const playfulRoute = playfulRouteRoom.routingDecisions.at(-1);
assert.equal(playfulRoute.selectedAgentId, null);
assert.ok(playfulRoute.blockedAgentIds.includes("vibe_friend_v1"));

const feedbackRouteRoom = createRoom("feedback-route", {
  agentIds: ["mediator_v1", "observer_v1"],
});
const firstFeedbackTrigger = addHumanMessage(feedbackRouteRoom, "Alex", "Can we decide this soon?");
const oldMediatorMessage = createAgentPlaceholder(feedbackRouteRoom, "mediator_v1", "old-decision");
finalizeAgentMessage(oldMediatorMessage, "Here is a long summary that interrupts the group.", 250);
addFeedback(feedbackRouteRoom, oldMediatorMessage.id, "should_have_stayed_quiet", "test_user");
const feedbackTrigger = addHumanMessage(feedbackRouteRoom, "Sam", "I think humans were already sorting this out.");
routeAgentDecisions(feedbackRouteRoom, feedbackTrigger, [
  makeDecision(feedbackRouteRoom, feedbackTrigger, "mediator_v1", {
    confidence: 0.5,
    groupState: "decision_needed",
    id: "mediator-feedback",
  }),
  makeDecision(feedbackRouteRoom, feedbackTrigger, "observer_v1", {
    confidence: 0.55,
    groupState: "decision_needed",
    id: "observer-feedback",
  }),
]);
const feedbackRoute = feedbackRouteRoom.routingDecisions.at(-1);
assert.equal(feedbackRoute.selectedAgentId, "observer_v1");
assert.ok(
  feedbackRoute.candidateScores
    .find((candidate) => candidate.agentId === "mediator_v1")
    .ruleAdjustments.includes("raised restraint after timing feedback"),
);

const quietParticipantRoom = createRoom("quiet-participant", {
  agentIds: ["observer_v1", "mediator_v1"],
});
addParticipant(quietParticipantRoom, "Alex", "human-alex");
addParticipant(quietParticipantRoom, "Jules", "human-jules");
addParticipant(quietParticipantRoom, "Sam", "human-sam");
addHumanMessage(quietParticipantRoom, "Alex", "I want to keep this cheap.");
addHumanMessage(quietParticipantRoom, "Alex", "Budget is still my main thing.");
addHumanMessage(quietParticipantRoom, "Alex", "I can only do one night.");
addHumanMessage(quietParticipantRoom, "Jules", "I want somewhere fun but can compromise.");
const quietTrigger = addHumanMessage(quietParticipantRoom, "Jules", "Should we lock in the city option?");
const quietDecisions = createAgentDecisions(quietParticipantRoom, quietTrigger);
const quietObserver = quietDecisions.find((decision) => decision.agentId === "observer_v1");
assert.equal(quietObserver.targetUser, "Sam");
assert.ok(quietObserver.reason.includes("quieter participant"));

console.log("core loop tests passed");
