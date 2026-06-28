const assert = require("assert");
const { addHumanMessage, buildReport, createRoom, createAgentDecisions } = require("../src/core");
const { OpenAIResponsesProvider, _internals } = require("../src/llmProvider");

async function main() {
  const room = createRoom("provider-room");
  const triggerMessage = addHumanMessage(room, "Alex", "Can we pick the cheap fun option?");
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    baseUrl: "https://api.openai.test/v1",
    model: "gpt-test",
    models: {
      decision: "gpt-classifier-test",
      router: "gpt-router-test",
      message: "gpt-message-test",
      report: "gpt-report-test",
    },
    timeoutMs: 5000,
  });
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    const schemaName = calls[calls.length - 1].body.text.format.name;
    const output = responseForSchema(schemaName);
    return {
      ok: true,
      status: 200,
      async json() {
        return { output_text: JSON.stringify(output) };
      },
    };
  };

  try {
    const decisions = await provider.decideAgents({
      room,
      triggerMessage,
      fallback: () => [],
    });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].roomId, room.id);
    assert.equal(decisions[0].triggerMessageId, triggerMessage.id);
    assert.equal(decisions[0].modelName, "gpt-classifier-test");
    assert.equal(decisions[0].decision, "speak");

    const localDecisions = createAgentDecisions(room, triggerMessage);
    const routeResult = await provider.routeDecisions({
      room,
      triggerMessage,
      decisions: localDecisions,
      fallback: () => null,
    });
    assert.equal(routeResult.routingDecision.roomId, room.id);
    assert.equal(routeResult.routingDecision.routerModelName, "gpt-router-test");
    assert.ok(routeResult.routedDecisions.every((decision) => decision.route.routingDecisionId));
    assert.ok(
      routeResult.routedDecisions.every((decision) => decision.route.routerModelName === "gpt-router-test"),
    );

    const messageResult = await provider.generateMessage({
      room,
      decision: decisions[0],
      fallback: () => "fallback",
    });
    assert.equal(messageResult.content, "Cheap city plus one good night out seems like the clean vote.");
    assert.equal(messageResult.modelName, "gpt-message-test");

    const draftReport = buildReport(room);
    const judgedReport = await provider.judgeReport({
      room,
      draftReport,
      fallback: () => draftReport,
    });
    const judgedMediator = judgedReport.agents.find((agent) => agent.agentId === "mediator_v1");
    const draftMediator = draftReport.agents.find((agent) => agent.agentId === "mediator_v1");
    assert.equal(judgedReport.id, draftReport.id);
    assert.equal(judgedReport.summary, "The model judge found the run useful but too eager.");
    assert.equal(judgedReport.roomStats.totalMessages, draftReport.roomStats.totalMessages);
    assert.equal(judgedReport.systemPerformance.reportGeneratedLocally, false);
    assert.equal(judgedReport.reportJudge.provider, "openai-responses");
    assert.equal(judgedReport.reportJudge.modelName, "gpt-report-test");
    assert.equal(judgedMediator.summary, "Mediator made the clearest decision-oriented intervention.");
    assert.equal(judgedMediator.policyDiff.before, draftMediator.policyDiff.before);
    assert.equal(judgedMediator.policyDiff.rationale, "Raise the speak threshold unless the room is choosing.");
    const reportCall = calls.find((call) => call.body.text.format.name === "shape_report_judge");
    const reportPrompt = JSON.parse(reportCall.body.input[1].content);
    assert.equal(reportPrompt.evalInputs.fullTranscript.length, room.messages.length);
    assert.equal(reportPrompt.evalInputs.fullTranscript[0].content, triggerMessage.content);
    assert.ok(Array.isArray(reportPrompt.evalInputs.agentDecisions));
    assert.ok(Array.isArray(reportPrompt.evalInputs.routingDecisions));
    assert.ok(Array.isArray(reportPrompt.evalInputs.messageFeedback));
    assert.ok(Array.isArray(reportPrompt.evalInputs.sessionFeedback));
    assert.ok(Array.isArray(reportPrompt.evalInputs.messageLatency));
    assert.equal(reportPrompt.evalInputs.agentConfigs.length, 3);
    assert.equal(reportPrompt.evalInputs.evidenceManifest.transcript.messages, room.messages.length);
    assert.equal(reportPrompt.draftReport.evidenceManifest.transcript.messages, room.messages.length);
    assert.ok(
      reportPrompt.draftReport.agents.every((agent) => agent.decisionReview && agent.routingScores),
      "report judge prompt should include per-agent decision review and routing scores",
    );

    assert.ok(calls.every((call) => call.url === "https://api.openai.test/v1/responses"));
    assert.ok(calls.every((call) => call.headers.Authorization === "Bearer test-key"));
    assert.deepEqual(
      calls.map((call) => call.body.text.format.name),
      ["agent_decisions", "routing_result", "group_chat_message", "shape_report_judge"],
    );
    assert.deepEqual(
      calls.map((call) => call.body.model),
      ["gpt-classifier-test", "gpt-router-test", "gpt-message-test", "gpt-report-test"],
    );

    assert.deepEqual(
      _internals.parseOpenAIResponseJson({ output_text: '{"content":"ok"}' }),
      { content: "ok" },
    );

    const timeoutRoom = createRoom("provider-timeout-room");
    const timeoutTrigger = addHumanMessage(timeoutRoom, "Alex", "Can we decide?");
    const timeoutError = new Error("The model request timed out.");
    timeoutError.name = "AbortError";
    global.fetch = async () => {
      throw timeoutError;
    };

    const originalConsoleError = console.error;
    let fallbackDecisions;
    try {
      console.error = () => {};
      fallbackDecisions = await provider.decideAgents({
        room: timeoutRoom,
        triggerMessage: timeoutTrigger,
        fallback: () => [],
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.deepEqual(fallbackDecisions, []);
    assert.equal(timeoutRoom.runtimeMetrics.llmErrors, 1);
    assert.equal(timeoutRoom.runtimeMetrics.timeouts, 1);

    const timeoutReport = buildReport(timeoutRoom);
    assert.equal(timeoutReport.systemPerformance.llmErrorRate, 1);
    assert.equal(timeoutReport.systemPerformance.timeoutRate, 1);
    assert.ok(_internals.isTimeoutError(timeoutError));
  } finally {
    global.fetch = originalFetch;
  }

  console.log("provider tests passed");
}

function responseForSchema(schemaName) {
  if (schemaName === "agent_decisions") {
    return {
      decisions: [
        {
          agentId: "mediator_v1",
          agentName: "Mediator",
          decision: "speak",
          targetUser: "Alex",
          reason: "The room needs a concrete decision.",
          confidence: 0.82,
          groupState: "decision_needed",
          roomType: "planning",
        },
      ],
    };
  }

  if (schemaName === "routing_result") {
    return {
      routingDecision: {
        selectedAgentId: "mediator_v1",
        selectedAgentName: "Mediator",
        reason: "Mediator is the best planning fit.",
        groupState: "decision_needed",
        roomType: "planning",
        routerVersion: "openai_router_v1",
      },
      decisions: [
        {
          agentId: "mediator_v1",
          agentName: "Mediator",
          decision: "speak",
          targetUser: "Alex",
          reason: "The room needs a concrete decision.",
          confidence: 0.82,
          groupState: "decision_needed",
          roomType: "planning",
        },
        {
          agentId: "vibe_friend_v1",
          agentName: "Vibe Friend",
          decision: "wait",
          targetUser: null,
          reason: "Planning momentum should not be interrupted.",
          confidence: 0.44,
          groupState: "decision_needed",
          roomType: "planning",
        },
      ],
    };
  }

  if (schemaName === "shape_report_judge") {
    return {
      summary: "The model judge found the run useful but too eager.",
      agents: [
        {
          agentId: "mediator_v1",
          summary: "Mediator made the clearest decision-oriented intervention.",
          failureModes: ["Over-participation"],
          policyDiffRationale: "Raise the speak threshold unless the room is choosing.",
          routingRecommendation: {
            recommendedFor: ["decision_needed", "planning"],
            avoidFor: ["high_human_momentum"],
            routeNextTime: true,
            reason: "Route when the group is converging on a choice.",
          },
        },
      ],
    };
  }

  return {
    content: "Cheap city plus one good night out seems like the clean vote.",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
