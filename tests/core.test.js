const assert = require("assert");
const {
  addFeedback,
  addHumanMessage,
  addSessionFeedback,
  buildReport,
  createAgentPlaceholder,
  createExport,
  createRoom,
  evaluateAndRouteAgents,
  finalizeAgentMessage,
  generateAgentReply,
  getRoomAgents,
  createAgentDecisions,
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

const room = createRoom("test-room");
assert.equal(getRoomAgents(room).length, 3, "default room should include three spec agents");

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

const report = buildReport(room);
const mediatorReport = report.agents.find((agent) => agent.agentId === "mediator_v1");

assert.equal(report.policyMode, "baseline");
assert.ok(report.summary.includes("baseline policy"));
assert.equal(report.sessionFeedbackSummary.totalResponses, 1);
assert.equal(report.sessionFeedbackSummary.routeNextAgentCounts.observer_v1, 1);
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
assert.ok("p99FullResponseLatencyMs" in report.systemPerformance);
assert.ok("maxReportQueueDepth" in report.systemPerformance);
assert.ok(report.systemPerformance.reportGeneratedLocally);

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

console.log("core loop tests passed");
