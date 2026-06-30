const PROMPT_VERSIONS = {
  agentDecision: "agent_decision_prompt_v1",
  router: "router_prompt_v1",
  message: "group_message_prompt_v1",
  reportJudge: "agent_report_judge_prompt_v1",
};

function buildAgentDecisionPrompt({ room, triggerMessage }) {
  return {
    version: PROMPT_VERSIONS.agentDecision,
    system:
      "You evaluate whether AI agents should participate in a multiplayer group chat. Judge social timing, restraint, target user, and group usefulness, not only factual helpfulness.",
    user: JSON.stringify(
      {
        task: "For each candidate agent, decide whether it should speak, stay_silent, or wait.",
        rules: [
          "Speak only if the agent can reduce confusion, help progress, improve emotional energy, include a quiet participant, resolve tension, summarize a decision, ask a high-leverage question, or prevent stalling.",
          "Stay silent when humans are actively bonding or already making progress.",
          "Prefer restraint over generic assistant behavior.",
        ],
        output: {
          decisions: [
            {
              agentId: "string",
              decision: "speak | stay_silent | wait",
              targetUser: "string|null",
              reason: "short string",
              confidence: "number from 0 to 1",
              groupState:
                "active | stalled | chaotic | tense | playful | decision_needed | emotionally_sensitive | high_human_momentum | low_human_momentum",
            },
          ],
        },
        room: compactPromptRoom(room),
        triggerMessage,
      },
      null,
      2,
    ),
  };
}

function buildRouterPrompt({ room, triggerMessage, decisions }) {
  return {
    version: PROMPT_VERSIONS.router,
    system:
      "You are the routing layer for a realtime group-chat AI system. Pick at most one agent to speak. You may block every agent if the room should stay human-led.",
    user: JSON.stringify(
      {
        task: "Route the best agent/model/policy into this turn.",
        routingRules: [
          "Use cheaper/faster decisions for classification and routing.",
          "Use stronger policies for emotionally complex or conflict-heavy moments.",
          "If multiple agents want to speak, select the one with the strongest fit and set the others to wait.",
          "If human momentum is high, prefer no speaker unless confidence is very high.",
        ],
        output: {
          routingDecision: {
            selectedAgentId: "string|null",
            reason: "short string",
            groupState: "string",
          },
          decisions: "same decisions array, with blocked speakers changed to wait and route metadata attached",
        },
        room: compactPromptRoom(room),
        triggerMessage,
        decisions,
      },
      null,
      2,
    ),
  };
}

function buildMessagePrompt({ room, decision }) {
  return {
    version: PROMPT_VERSIONS.message,
    system:
      "You are writing as an AI participant in a group chat. Be short, socially natural, and faithful to the selected agent personality. Help humans talk to each other.",
    user: JSON.stringify(
      {
        task: "Generate one group-chat-native message for the selected agent.",
        rules: [
          "Keep it short.",
          "Do not sound like a generic assistant.",
          "Do not answer every message.",
          "Respond to social context, not just the latest message.",
          "Prefer useful questions over long advice.",
        ],
        output: { content: "string" },
        room: compactPromptRoom(room),
        decision,
      },
      null,
      2,
    ),
  };
}

function buildReportJudgePrompt({ room, draftReport }) {
  return {
    version: PROMPT_VERSIONS.reportJudge,
    system:
      "Evaluate AI agents as multiplayer group-chat participants. Review the deterministic draft report and improve only the narrative judgment fields. Preserve measured metrics, ids, evidence, and policy text.",
    user: JSON.stringify(
      {
        task: "Return a structured judge patch for the Agent Performance Report.",
        rules: [
          "Judge whether each agent improved the group dynamic, not only factual helpfulness.",
          "Do not invent feedback or transcript evidence.",
          "Do not rewrite scorecards, stats, ids, policy before/after text, best messages, or worst messages.",
          "Make summaries concrete enough to guide the next routing and policy iteration.",
        ],
        rubric: [
          "Did it speak at the right times?",
          "Did it stay quiet when humans were making progress?",
          "Did it understand who wanted what?",
          "Did it help the group reach a decision?",
          "Did it preserve its personality?",
          "Did it sound natural in a group chat?",
          "Did it increase or decrease human conversation?",
          "Did it improve, worsen, or stabilize human mood?",
          "Did it remember participant preferences and constraints?",
          "Did it miss tension, jokes, or quieter participants?",
        ],
        output: {
          agents: [
            {
              agentId: "string",
              summary: "string",
              failureModes: "array",
              policyDiffRationale: "string",
              routingRecommendation: {
                recommendedFor: "array",
                avoidFor: "array",
                routeNextTime: "boolean",
                reason: "string",
              },
            },
          ],
        },
        evalInputs: buildReportEvalInputs(room, draftReport),
        room: compactPromptRoom(room),
        draftReport: draftReport ? compactPromptReport(draftReport) : null,
      },
      null,
      2,
    ),
  };
}

function compactPromptRoom(room) {
  return {
    id: room.id,
    scenario: room.scenario,
    selectedAgentIds: room.selectedAgentIds,
    policyMode: room.policyMode,
    currentPolicyVersion: room.currentPolicyVersion,
    activePolicyOverrides: room.activePolicyOverrides || {},
    routerVersion: room.routerVersion,
    currentGroupState: room.currentGroupState,
    participants: [...room.participants.values()],
    agents: room.selectedAgentIds,
    recentMessages: room.messages.slice(-12),
    recentDecisions: room.decisions.slice(-12),
    recentRoutingDecisions: room.routingDecisions.slice(-6),
    feedback: room.feedback.slice(-40),
    sessionFeedback: room.sessionFeedback.slice(-10),
  };
}

function buildReportEvalInputs(room, draftReport) {
  const messages = Array.isArray(room.messages) ? room.messages : [];
  const aiMessages = messages.filter((message) => message.senderType === "ai");
  const evidenceManifest = draftReport && draftReport.evidenceManifest ? draftReport.evidenceManifest : null;

  return {
    scenarioMetadata: room.scenario,
    fullTranscript: messages.map(compactPromptMessage),
    agentDecisions: Array.isArray(room.decisions) ? room.decisions : [],
    routingDecisions: Array.isArray(room.routingDecisions) ? room.routingDecisions : [],
    messageFeedback: Array.isArray(room.feedback) ? room.feedback : [],
    sessionFeedback: Array.isArray(room.sessionFeedback) ? room.sessionFeedback : [],
    roomMemoryLedger: draftReport && draftReport.roomMemoryLedger ? draftReport.roomMemoryLedger : null,
    roomMoodTimeline: draftReport && draftReport.roomMoodTimeline ? draftReport.roomMoodTimeline : null,
    messageLatency: aiMessages.map((message) => ({
      messageId: message.id,
      agentId: message.agentId || null,
      decisionId: message.decisionId || null,
      latencyMs: message.latencyMs,
      firstTokenLatencyMs: message.firstTokenLatencyMs,
      tokenCount: message.tokenCount,
      modelName: message.modelName,
      promptVersion: message.promptVersion,
      policyVersion: message.policyVersion,
    })),
    agentConfigs: evidenceManifest ? evidenceManifest.agentConfigs || [] : [],
    evidenceManifest,
  };
}

function compactPromptMessage(message) {
  return {
    id: message.id,
    senderId: message.senderId || null,
    senderName: message.senderName,
    senderType: message.senderType,
    agentId: message.agentId || null,
    content: message.content,
    createdAt: message.createdAt,
    replyToMessageId: message.replyToMessageId || null,
    decisionId: message.decisionId || null,
    feedbackTags: Array.isArray(message.feedback) ? message.feedback.map((entry) => entry.tag) : [],
    latencyMs: message.latencyMs,
    firstTokenLatencyMs: message.firstTokenLatencyMs,
    tokenCount: message.tokenCount,
    modelName: message.modelName,
    promptVersion: message.promptVersion,
    policyVersion: message.policyVersion,
  };
}

function compactPromptReport(report) {
  return {
    id: report.id,
    roomId: report.roomId,
    scenarioTitle: report.scenarioTitle,
    sessionNumber: report.sessionNumber,
    policyMode: report.policyMode,
    summary: report.summary,
    roomStats: report.roomStats,
    sessionFeedbackSummary: report.sessionFeedbackSummary,
    modelRoutingSummary: report.modelRoutingSummary,
    evidenceManifest: report.evidenceManifest,
    roomMemoryLedger: report.roomMemoryLedger,
    roomMoodTimeline: report.roomMoodTimeline,
    systemPerformance: report.systemPerformance,
    agents: report.agents.map((agentReport) => ({
      agentId: agentReport.agentId,
      agentName: agentReport.agentName,
      role: agentReport.role,
      summary: agentReport.summary,
      scorecard: agentReport.scorecard,
      stats: agentReport.stats,
      failureModes: agentReport.failureModes,
      bestMessages: agentReport.bestMessages,
      worstMessages: agentReport.worstMessages,
      decisionReview: agentReport.decisionReview,
      socialIntelligenceReview: agentReport.socialIntelligenceReview,
      automaticReception: agentReport.automaticReception,
      routingScores: agentReport.routingScores,
      policyDiff: agentReport.policyDiff,
      routingRecommendation: agentReport.routingRecommendation,
    })),
    comparison: report.comparison,
  };
}

module.exports = {
  PROMPT_VERSIONS,
  buildAgentDecisionPrompt,
  buildMessagePrompt,
  buildReportJudgePrompt,
  buildRouterPrompt,
  buildReportEvalInputs,
  compactPromptReport,
  compactPromptRoom,
};
