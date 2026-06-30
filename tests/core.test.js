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
  scenarios,
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
const weekendTrip = scenarios.find((scenario) => scenario.id === "weekend_trip");
assert.ok(weekendTrip, "weekend trip MVP scenario should exist");
assert.ok(new Set(weekendTrip.sampleScript.map(([speaker]) => speaker)).size >= 4);
assert.ok(
  weekendTrip.sampleScript.some(([, content]) => /pizza|side quest|off topic/i.test(content)),
  "weekend trip scenario should include the derailing fourth-friend beat from the spec",
);
for (const roomType of [
  "planning",
  "drama_conflict",
  "casual_hangout",
  "fandom_rp",
  "study_work",
  "advice",
  "game_night",
  "debate",
  "support_emotional",
]) {
  assert.ok(
    scenarios.some((scenario) => scenario.roomType === roomType),
    `scenario catalog should cover ${roomType}`,
  );
}

const replyRoom = createRoom("reply-room");
const replyRoot = addHumanMessage(replyRoom, "Alex", "Cheap is the constraint.");
assert.throws(
  () => addFeedback(replyRoom, replyRoot.id, "helpful", "test_user"),
  /only be added to AI messages/,
);
const humanReply = addHumanMessage(replyRoom, "Jules", "Agreeing with Alex here.", {
  replyToMessageId: replyRoot.id,
});
assert.equal(humanReply.replyToMessageId, replyRoot.id);
const replyDecisions = evaluateAndRouteAgents(replyRoom, humanReply);
const replySpeaker = replyDecisions.find((decision) => decision.decision === "speak");
if (replySpeaker) {
  const replyAiMessage = createAgentPlaceholder(replyRoom, replySpeaker.agentId, replySpeaker.id);
  assert.equal(replyAiMessage.replyToMessageId, humanReply.id);
}

const singleAgentRoom = createRoom("single-agent-request", {
  agentIds: ["observer_v1"],
});
assert.equal(singleAgentRoom.selectedAgentIds.length, 2, "rooms should enforce the two-agent minimum");
assert.ok(singleAgentRoom.selectedAgentIds.includes("observer_v1"));

const tooManyAgentsRoom = createRoom("too-many-agent-request", {
  agentIds: ["observer_v1", "mediator_v1", "vibe_friend_v1", "unknown_agent"],
});
assert.equal(tooManyAgentsRoom.selectedAgentIds.length, 3, "rooms should cap selected agents at three");

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
assert.equal(room.routingDecisions[0].modelRouting.decision.tier, "fast");
assert.equal(room.routingDecisions[0].modelRouting.router.tier, "fast");
assert.equal(room.routingDecisions[0].modelRouting.report.tier, "strong");
assert.ok(
  room.decisions.every((decision) => decision.route && decision.route.routingDecisionId),
  "each decision should point back to a routing decision",
);
assert.ok(
  room.decisions.every((decision) => decision.modelRouting && decision.modelRouting.decision.tier === "fast"),
  "each decision should include model-routing tier evidence",
);
assert.ok(
  room.decisions.every((decision) => decision.route && decision.route.routerModelName === "local-rule-router"),
  "each local route should expose the router model metadata",
);

addFeedback(room, aiMessages[0].id, "too_verbose", "test_user");
addFeedback(room, aiMessages[0].id, "should_have_stayed_quiet", "test_user");
addFeedback(room, aiMessages[0].id, "too_assistant_like", "test_user");
addFeedback(room, aiMessages[0].id, "responded_wrong_person", "test_user");
addFeedback(room, aiMessages[0].id, "memory_miss", "test_user");
addFeedback(room, aiMessages[0].id, "good_restraint", "test_user");
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
assert.equal(report.modelRoutingSummary.latestPlan.decision.tier, "fast");
assert.equal(report.modelRoutingSummary.latestPlan.report.tier, "strong");
assert.equal(report.evidenceManifest.scenario.roomType, room.scenario.roomType);
assert.equal(report.evidenceManifest.transcript.messages, room.messages.length);
assert.equal(report.evidenceManifest.decisions.agentDecisions, room.decisions.length);
assert.equal(report.evidenceManifest.feedback.messageFeedback, room.feedback.length);
assert.equal(report.evidenceManifest.agentConfigs.length, 3);
assert.ok(report.evidenceManifest.latency.responseLatencySamples >= 0);
assert.ok(report.roomMemoryLedger.coverage.totalFacts >= 3, "report should extract room memory facts");
assert.ok(
  report.roomMemoryLedger.facts.some((fact) => fact.participantName === "Alex" && fact.ruleId === "budget_sensitive"),
  "memory ledger should remember Alex's budget constraint",
);
assert.ok(report.evidenceManifest.memory.facts >= 3, "eval manifest should summarize memory evidence");
assert.ok(report.roomMoodTimeline.humanMoodEvents.length >= 3, "report should infer human mood events");
assert.ok(report.evidenceManifest.mood.humanMoodEvents >= 3, "eval manifest should summarize mood evidence");
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
for (const statKey of [
  "targetedDecisions",
  "targetedDecisionRate",
  "replyTargetedMessages",
  "replyTargetRate",
  "wrongPersonFeedbackRate",
  "quietParticipantTargetRate",
  "targetUserCounts",
  "humanConversationDelta",
  "humanConversationLift",
  "humanMomentumDirection",
]) {
  assert.ok(statKey in mediatorReport.stats, `agent stats should include ${statKey}`);
}
assert.ok(["more", "less", "same"].includes(mediatorReport.stats.humanMomentumDirection));
assert.ok(Number.isFinite(mediatorReport.stats.humanConversationDelta));
assert.ok(Number.isFinite(mediatorReport.stats.humanConversationLift));
assert.ok(mediatorReport.stats.replyTargetRate > 0, "AI messages should preserve reply targeting in stats");
assert.ok(
  Object.values(mediatorReport.stats.targetUserCounts).some((count) => count > 0),
  "target user counts should show who decisions were aimed at",
);
const firstAiAgentReport = report.agents.find((agent) => agent.agentId === aiMessages[0].agentId);
assert.ok(firstAiAgentReport.stats.wrongPersonFeedbackRate > 0);
assert.ok(firstAiAgentReport.failureModes.includes("Wrong person targeting"));
assert.ok(firstAiAgentReport.failureModes.includes("Memory miss"));
assert.ok(firstAiAgentReport.socialIntelligenceReview, "agent report should include social intelligence review");
assert.ok(Array.isArray(firstAiAgentReport.automaticReception), "agent report should include automatic reception");
assert.ok(
  firstAiAgentReport.automaticReception.every((entry) => ["positive", "negative", "unclear"].includes(entry.sentiment)),
  "automatic reception should classify message reception without manual labels",
);
assert.ok(
  firstAiAgentReport.socialIntelligenceReview.categories.some((category) => category.id === "memory_context"),
  "social review should include memory/context category",
);
assert.ok(
  firstAiAgentReport.socialIntelligenceReview.categories.some((category) => category.id === "mood_impact"),
  "social review should include mood impact category",
);
for (const scoreKey of ["casualScore", "roleplayScore", "adviceScore", "gameNightScore", "debateScore", "supportScore"]) {
  assert.ok(scoreKey in mediatorReport.routingScores, `routing scores should include ${scoreKey}`);
}
assert.ok(mediatorReport.decisionReview, "agent report should include participation decision review");
assert.ok(["yes", "no", "mixed", "not_tested", "insufficient_evidence"].includes(mediatorReport.decisionReview.shouldHaveSpoken));
assert.equal(
  mediatorReport.decisionReview.totalDecisions,
  room.decisions.filter((decision) => decision.agentId === "mediator_v1").length,
);
assert.ok(Array.isArray(mediatorReport.decisionReview.sampledDecisions));
assert.ok(
  mediatorReport.decisionReview.sampledDecisions.every(
    (decision) => decision.decisionId && decision.triggerMessageId && "selectedByRouter" in decision,
  ),
);
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

room.activePolicyOverrides = { mediator_v1: refreshedReport.agents[0].policyDiff.after };
resetRoomForNextRun(room, "improved", {
  currentPolicyVersion: `improved_from_${refreshedReport.id.slice(0, 8)}`,
  nextSessionNumber: room.sessionNumber + 1,
});
assert.equal(room.sessionNumber, 2);
assert.equal(room.runHistory.length, 1);
assert.equal(room.runHistory[0].policyMode, "baseline");
assert.equal(room.runHistory[0].currentPolicyVersion, "baseline_v1");
assert.ok(room.currentPolicyVersion.startsWith("improved_from_"));
assert.ok(room.runHistory[0].messages.length >= aiMessages.length);
assert.ok(room.runHistory[0].reports.some((archivedReport) => archivedReport.id === refreshedReport.id));

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
assert.ok(improvedReport.evidenceManifest.archive.runSnapshots >= 1);
assert.ok(Array.isArray(improvedReport.comparison));
assert.ok(improvedReport.comparison.every((item) => item.baseline && item.improved));
assert.ok(
  improvedReport.comparison.every((item) => Number.isFinite(item.baseline.totalMessages)),
  "comparison should include baseline side-by-side metrics",
);
assert.ok(
  improvedReport.comparison.every((item) => "replyTargetRate" in item.baseline && "wrongPersonFeedbackRate" in item.baseline),
  "comparison should include targeting metrics",
);
assert.ok(
  improvedReport.comparison.every((item) => "humanConversationLift" in item.baseline && "humanMomentumDirection" in item.baseline),
  "comparison should include human momentum metrics",
);
assert.ok(
  improvedReport.comparison.every((item) => "memoryReferenceRate" in item.baseline && "moodImpactScore" in item.baseline),
  "comparison should include memory and mood metrics",
);
room.activePolicyOverrides = { mediator_v1: improvedReport.agents[0].policyDiff.after };
room.currentPolicyVersion = `improved_from_${improvedReport.id.slice(0, 8)}`;
resetRoomForNextRun(room, "improved");
assert.ok(room.currentPolicyVersion.startsWith("improved_from_"));
assert.equal(room.runHistory.length, 2);
assert.equal(room.runHistory[1].policyMode, "improved");
assert.ok(room.runHistory[1].reports.some((archivedReport) => archivedReport.id === improvedReport.id));

setRoomConfig(room, {
  scenarioId: "friend_conflict",
  agentIds: ["observer_v1"],
});
assert.equal(room.selectedAgentIds.length, 2, "configuration should also enforce the two-agent minimum");
assert.ok(room.selectedAgentIds.includes("observer_v1"));
room.messages = [];
room.decisions = [];
room.feedback = [];
const observerTurn = runAgentTurn(room, "Rae", "I feel ignored and nobody is listening.");
assert.ok(observerTurn, "observer should intervene in a tense room when selected");
assert.equal(observerTurn.aiMessage.agentId, "observer_v1");

const exported = createExport(room);
assert.equal(exported.room.id, "test-room");
assert.ok(exported.roomMemoryLedger, "export should include current room memory ledger");
assert.ok(exported.roomMoodTimeline, "export should include current room mood timeline");
assert.ok(Array.isArray(exported.transcript));
assert.ok(
  exported.transcript
    .filter((message) => message.senderType === "ai")
    .every(
      (message) =>
        message.senderId &&
        message.modelName &&
        message.promptVersion &&
        message.policyVersion &&
        message.decisionId &&
        Number.isFinite(message.latencyMs) &&
        Number.isFinite(message.tokenCount) &&
        "firstTokenLatencyMs" in message &&
        "latency_ms" in message &&
        "token_count" in message,
    ),
  "export transcript should preserve AI sender, latency, token, model, prompt, policy, and decision metadata",
);
assert.ok(
  exported.transcript.every((message) => "replyToMessageId" in message),
  "export transcript should preserve reply targeting metadata",
);
assert.ok(Array.isArray(exported.runs), "export should include before/after run archive");
assert.ok(exported.runs.length >= 3, "export should include baseline, improved, and current run snapshots");
assert.ok(
  exported.runs.some((run) => run.policyMode === "baseline" && run.transcript.length > 0),
  "run archive should preserve baseline transcript",
);
assert.ok(
  exported.runs.some((run) => run.policyMode === "improved" && run.transcript.length > 0),
  "run archive should preserve improved transcript",
);
assert.ok(
  exported.runs.some((run) => run.roomMemoryLedger && run.roomMoodTimeline),
  "run archive should preserve memory and mood evidence",
);
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

const emotionalRouteRoom = createRoom("emotional-route", {
  scenarioId: "friend_conflict",
  agentIds: ["vibe_friend_v1", "observer_v1", "mediator_v1"],
});
const emotionalTrigger = addHumanMessage(emotionalRouteRoom, "Rae", "I feel hurt and overwhelmed, and honestly not okay.");
const emotionalDecisions = routeAgentDecisions(emotionalRouteRoom, emotionalTrigger, [
  makeDecision(emotionalRouteRoom, emotionalTrigger, "vibe_friend_v1", {
    confidence: 0.95,
    groupState: "emotionally_sensitive",
    id: "vibe-emotional",
  }),
  makeDecision(emotionalRouteRoom, emotionalTrigger, "observer_v1", {
    confidence: 0.7,
    groupState: "emotionally_sensitive",
    id: "observer-emotional",
  }),
  makeDecision(emotionalRouteRoom, emotionalTrigger, "mediator_v1", {
    confidence: 0.66,
    groupState: "emotionally_sensitive",
    id: "mediator-emotional",
  }),
]);
const emotionalRoute = emotionalRouteRoom.routingDecisions.at(-1);
assert.equal(emotionalRoute.groupState, "emotionally_sensitive");
assert.equal(emotionalRoute.selectedAgentId, "observer_v1");
assert.equal(emotionalRoute.modelRouting.message.tier, "strong");
assert.ok(emotionalRoute.modelRouting.escalationReasons.includes("emotionally sensitive response"));
assert.ok(emotionalRoute.blockedAgentIds.includes("vibe_friend_v1"));
assert.equal(
  emotionalDecisions.find((decision) => decision.agentId === "vibe_friend_v1").decision,
  "wait",
);

const casualRouteRoom = createRoom("casual-route", {
  scenarioId: "casual_hangout",
  agentIds: ["vibe_friend_v1", "observer_v1", "mediator_v1"],
});
const casualTrigger = addHumanMessage(casualRouteRoom, "Alex", "Tiny low-effort idea for tonight?");
routeAgentDecisions(casualRouteRoom, casualTrigger, createAgentDecisions(casualRouteRoom, casualTrigger));
const casualRoute = casualRouteRoom.routingDecisions.at(-1);
assert.equal(casualRoute.roomType, "casual_hangout");
assert.equal(casualRoute.selectedAgentId, "vibe_friend_v1");

const supportRouteRoom = createRoom("support-route", {
  scenarioId: "support_checkin",
  agentIds: ["vibe_friend_v1", "observer_v1", "mediator_v1"],
});
const supportTrigger = addHumanMessage(supportRouteRoom, "Rae", "I am overwhelmed and lonely tonight.");
routeAgentDecisions(supportRouteRoom, supportTrigger, createAgentDecisions(supportRouteRoom, supportTrigger));
const supportRoute = supportRouteRoom.routingDecisions.at(-1);
assert.equal(supportRoute.roomType, "support_emotional");
assert.equal(supportRoute.selectedAgentId, "observer_v1");
assert.equal(supportRoute.modelRouting.message.tier, "strong");

const stalledRouteRoom = createRoom("stalled-route", {
  agentIds: ["vibe_friend_v1", "mediator_v1", "observer_v1"],
});
const stalledTrigger = addHumanMessage(stalledRouteRoom, "Alex", "Anyone still here? I am stuck and have no idea what now.");
routeAgentDecisions(stalledRouteRoom, stalledTrigger, [
  makeDecision(stalledRouteRoom, stalledTrigger, "vibe_friend_v1", {
    confidence: 0.5,
    groupState: "stalled",
    id: "vibe-stalled",
  }),
  makeDecision(stalledRouteRoom, stalledTrigger, "mediator_v1", {
    confidence: 0.55,
    groupState: "stalled",
    id: "mediator-stalled",
  }),
  makeDecision(stalledRouteRoom, stalledTrigger, "observer_v1", {
    confidence: 0.5,
    groupState: "stalled",
    id: "observer-stalled",
  }),
]);
const stalledRoute = stalledRouteRoom.routingDecisions.at(-1);
assert.equal(stalledRoute.groupState, "stalled");
assert.equal(stalledRoute.selectedAgentId, "vibe_friend_v1");
assert.ok(
  stalledRoute.candidateScores
    .find((candidate) => candidate.agentId === "vibe_friend_v1")
    .ruleAdjustments.includes("boosted Vibe Friend to revive stalled room"),
);

const chaoticRouteRoom = createRoom("chaotic-route", {
  agentIds: ["vibe_friend_v1", "observer_v1", "mediator_v1"],
});
addHumanMessage(chaoticRouteRoom, "Alex", "This is random side quest energy.");
const chaoticTrigger = addHumanMessage(chaoticRouteRoom, "Jules", "Pizza memes, off topic ideas, and three threads are spiraling.");
routeAgentDecisions(chaoticRouteRoom, chaoticTrigger, [
  makeDecision(chaoticRouteRoom, chaoticTrigger, "vibe_friend_v1", {
    confidence: 0.74,
    groupState: "chaotic",
    id: "vibe-chaotic",
  }),
  makeDecision(chaoticRouteRoom, chaoticTrigger, "observer_v1", {
    confidence: 0.58,
    groupState: "chaotic",
    id: "observer-chaotic",
  }),
  makeDecision(chaoticRouteRoom, chaoticTrigger, "mediator_v1", {
    confidence: 0.52,
    groupState: "chaotic",
    id: "mediator-chaotic",
  }),
]);
const chaoticRoute = chaoticRouteRoom.routingDecisions.at(-1);
assert.equal(chaoticRoute.groupState, "chaotic");
assert.equal(chaoticRoute.selectedAgentId, "observer_v1");
assert.ok(chaoticRoute.blockedAgentIds.includes("vibe_friend_v1"));

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
