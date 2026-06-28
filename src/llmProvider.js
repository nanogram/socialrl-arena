const {
  buildAgentDecisionPrompt,
  buildMessagePrompt,
  buildReportJudgePrompt,
  buildRouterPrompt,
} = require("./prompts");
const { agents } = require("./core");
const { randomUUID } = require("crypto");

function createLlmProvider() {
  if (process.env.LLM_PROVIDER === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("LLM_PROVIDER=openai set without OPENAI_API_KEY; using local provider.");
      return new LocalLlmProvider();
    }

    return new OpenAIResponsesProvider({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      models: {
        decision: process.env.OPENAI_DECISION_MODEL,
        router: process.env.OPENAI_ROUTER_MODEL,
        message: process.env.OPENAI_MESSAGE_MODEL,
        report: process.env.OPENAI_REPORT_MODEL,
      },
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 20000),
    });
  }

  if (process.env.LLM_PROVIDER === "http") {
    return new HttpLlmProvider({
      decisionUrl: process.env.LLM_DECISION_URL,
      routerUrl: process.env.LLM_ROUTER_URL,
      messageUrl: process.env.LLM_MESSAGE_URL,
      reportUrl: process.env.LLM_REPORT_URL,
      apiKey: process.env.LLM_API_KEY,
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 12000),
    });
  }

  return new LocalLlmProvider();
}

class LocalLlmProvider {
  constructor() {
    this.name = "local-policy-sim";
  }

  async decideAndRoute({ fallback }) {
    return fallback();
  }

  async decideAgents({ fallback }) {
    return fallback();
  }

  async routeDecisions({ fallback }) {
    return fallback();
  }

  async generateMessage({ fallback }) {
    return fallback();
  }

  async judgeReport({ fallback }) {
    return fallback();
  }
}

class HttpLlmProvider {
  constructor(options) {
    this.name = "http-llm-provider";
    this.decisionUrl = options.decisionUrl;
    this.routerUrl = options.routerUrl;
    this.messageUrl = options.messageUrl;
    this.reportUrl = options.reportUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  async decideAndRoute({ room, triggerMessage, fallback }) {
    if (!this.decisionUrl) return fallback();

    try {
      const response = await postJson(
        this.decisionUrl,
        {
          task: "decide_and_route_agents",
          prompt: buildAgentDecisionPrompt({ room, triggerMessage }),
          room: compactRoom(room),
          triggerMessage,
        },
        this.headers(),
        this.timeoutMs,
      );
      const decisions = normalizeDecisionResponse(response);
      if (!decisions.length) return fallback();
      room.currentGroupState = decisions[0].groupState || room.currentGroupState;
      room.decisions.push(...decisions);
      return decisions;
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("LLM decision provider failed, using local fallback:", error.message);
      return fallback();
    }
  }

  async decideAgents({ room, triggerMessage, fallback }) {
    if (!this.decisionUrl) return fallback();

    try {
      const response = await postJson(
        this.decisionUrl,
        {
          task: "decide_agents",
          prompt: buildAgentDecisionPrompt({ room, triggerMessage }),
          room: compactRoom(room),
          triggerMessage,
        },
        this.headers(),
        this.timeoutMs,
      );
      const decisions = normalizeDecisionResponse(response);
      return decisions.length ? decisions : fallback();
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("LLM decision provider failed, using local fallback:", error.message);
      return fallback();
    }
  }

  async routeDecisions({ room, triggerMessage, decisions, fallback }) {
    if (!this.routerUrl) return fallback();

    try {
      const response = await postJson(
        this.routerUrl,
        {
          task: "route_decisions",
          prompt: buildRouterPrompt({ room, triggerMessage, decisions }),
          room: compactRoom(room),
          triggerMessage,
          decisions,
        },
        this.headers(),
        this.timeoutMs,
      );
      const result = normalizeRouteResponse(response);
      return result || fallback();
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("LLM router provider failed, using local fallback:", error.message);
      return fallback();
    }
  }

  async generateMessage({ room, decision, fallback }) {
    if (!this.messageUrl) return fallback();

    try {
      const prompt = buildMessagePrompt({ room, decision });
      const response = await postJson(
        this.messageUrl,
        {
          task: "generate_group_chat_message",
          prompt,
          room: compactRoom(room),
          decision,
        },
        this.headers(),
        this.timeoutMs,
      );
      const content = String(response.content || response.message || "").trim();
      if (!content) return fallback();
      return {
        content,
        modelName: response.modelName || response.model || null,
        promptVersion: response.promptVersion || prompt.version,
      };
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("LLM message provider failed, using local fallback:", error.message);
      return fallback();
    }
  }

  async judgeReport({ room, draftReport, fallback }) {
    if (!this.reportUrl) return fallback();

    try {
      const prompt = buildReportJudgePrompt({ room, draftReport });
      const response = await postJson(
        this.reportUrl,
        {
          task: "judge_agent_report",
          prompt,
          room: compactRoom(room),
          draftReport,
        },
        this.headers(),
        this.timeoutMs,
      );
      return mergeJudgedReport(draftReport, response, {
        providerName: this.name,
        promptVersion: prompt.version,
      });
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("LLM report judge provider failed, using local fallback:", error.message);
      return fallback();
    }
  }

  headers() {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}

class OpenAIResponsesProvider {
  constructor(options) {
    this.name = "openai-responses";
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.models = {
      decision: options.models && options.models.decision,
      router: options.models && options.models.router,
      message: options.models && options.models.message,
      report: options.models && options.models.report,
    };
    this.timeoutMs = options.timeoutMs;
  }

  async decideAndRoute({ room, triggerMessage, fallback }) {
    const rawDecisions = await this.decideAgents({
      room,
      triggerMessage,
      fallback: () => null,
    });
    if (!rawDecisions) return fallback();

    const routed = await this.routeDecisions({
      room,
      triggerMessage,
      decisions: rawDecisions,
      fallback: () => null,
    });
    if (!routed) return fallback();

    room.currentGroupState = routed.routingDecision.groupState || room.currentGroupState;
    room.routingDecisions.push(routed.routingDecision);
    room.decisions.push(...routed.routedDecisions);
    return routed.routedDecisions;
  }

  async decideAgents({ room, triggerMessage, fallback }) {
    try {
      const model = this.modelFor("decision");
      const response = await this.callResponses({
        prompt: buildAgentDecisionPrompt({ room, triggerMessage }),
        schemaName: "agent_decisions",
        schema: AGENT_DECISIONS_SCHEMA,
        model,
      });
      const decisions = normalizeDecisionResponse(response).map((decision) =>
        enrichExternalDecision(decision, room, triggerMessage, null, model),
      );
      return decisions.length ? decisions : fallback();
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("OpenAI decision call failed, using fallback:", error.message);
      return fallback();
    }
  }

  async routeDecisions({ room, triggerMessage, decisions, fallback }) {
    try {
      const model = this.modelFor("router");
      const response = await this.callResponses({
        prompt: buildRouterPrompt({ room, triggerMessage, decisions }),
        schemaName: "routing_result",
        schema: ROUTING_RESULT_SCHEMA,
        model,
      });
      const result = normalizeRouteResponse(response);
      if (!result) return fallback();
      const routingDecision = enrichRoutingDecision(
        result.routingDecision,
        room,
        triggerMessage,
        decisions,
        model,
      );
      const routedDecisions = result.routedDecisions.map((decision) => {
        const original = decisions.find((candidate) => candidate.agentId === decision.agentId);
        return enrichExternalDecision(
          decision,
          room,
          triggerMessage,
          original,
          (original && original.modelName) || this.modelFor("decision"),
          routingDecision,
        );
      });
      return { routingDecision, routedDecisions };
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("OpenAI router call failed, using fallback:", error.message);
      return fallback();
    }
  }

  async generateMessage({ room, decision, fallback }) {
    try {
      const prompt = buildMessagePrompt({ room, decision });
      const model = this.modelFor("message");
      const response = await this.callResponses({
        prompt,
        schemaName: "group_chat_message",
        schema: MESSAGE_SCHEMA,
        maxOutputTokens: 180,
        model,
      });
      const content = String(response.content || "").trim();
      if (!content) return fallback();
      return {
        content,
        modelName: model,
        promptVersion: prompt.version,
      };
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("OpenAI message call failed, using fallback:", error.message);
      return fallback();
    }
  }

  async judgeReport({ room, draftReport, fallback }) {
    try {
      const prompt = buildReportJudgePrompt({ room, draftReport });
      const model = this.modelFor("report");
      const response = await this.callResponses({
        prompt,
        schemaName: "agent_report_judge",
        schema: REPORT_JUDGE_SCHEMA,
        maxOutputTokens: 2200,
        model,
      });
      return mergeJudgedReport(draftReport, response, {
        providerName: this.name,
        modelName: model,
        promptVersion: prompt.version,
      });
    } catch (error) {
      recordProviderFailure(room, error);
      console.error("OpenAI report judge call failed, using fallback:", error.message);
      return fallback();
    }
  }

  modelFor(stage) {
    return this.models[stage] || this.model;
  }

  async callResponses({ prompt, schemaName, schema, maxOutputTokens = 900, model = this.model }) {
    const body = {
      model,
      input: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      reasoning: { effort: "low" },
      max_output_tokens: maxOutputTokens,
      store: false,
    };

    const response = await postJson(
      `${this.baseUrl}/responses`,
      body,
      { Authorization: `Bearer ${this.apiKey}` },
      this.timeoutMs,
    );
    return parseOpenAIResponseJson(response);
  }
}

async function postJson(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDecisionResponse(response) {
  const decisions = Array.isArray(response.decisions) ? response.decisions : [];
  return decisions
    .filter((decision) => decision && decision.agentId && decision.decision)
    .map((decision) => ({
      ...decision,
      id: decision.id || randomUUID(),
      decision: ["speak", "stay_silent", "wait"].includes(decision.decision)
        ? decision.decision
        : "wait",
      confidence: Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : 0,
      createdAt: decision.createdAt || new Date().toISOString(),
    }));
}

function normalizeRouteResponse(response) {
  const routedDecisions = normalizeDecisionResponse({
    decisions: response.decisions || response.routedDecisions,
  });
  const routingDecision = response.routingDecision;
  if (!routingDecision || !Array.isArray(routedDecisions) || !routedDecisions.length) {
    return null;
  }

  const normalizedRoutingDecision = {
    ...routingDecision,
    id: routingDecision.id || randomUUID(),
    createdAt: routingDecision.createdAt || new Date().toISOString(),
  };

  return {
    routingDecision: normalizedRoutingDecision,
    routedDecisions: routedDecisions.map((decision) => ({
      ...decision,
      route: decision.route || {
        routingDecisionId: normalizedRoutingDecision.id,
        routerVersion: normalizedRoutingDecision.routerVersion || "external_router_v1",
        roomType: normalizedRoutingDecision.roomType || decision.roomType,
        groupState: normalizedRoutingDecision.groupState || decision.groupState,
        selectedAgentId: normalizedRoutingDecision.selectedAgentId || null,
        reason: normalizedRoutingDecision.reason || "External router selected this outcome.",
      },
    })),
  };
}

function mergeJudgedReport(draftReport, response, metadata = {}) {
  const patch = extractReportPatch(response);
  if (!patch || !draftReport) return draftReport;

  let changed = false;
  const report = {
    ...draftReport,
    agents: draftReport.agents.map((agentReport) => {
      const agentPatch = patch.agents.find((agent) => agent.agentId === agentReport.agentId);
      if (!agentPatch) return agentReport;

      const mergedAgent = mergeAgentReportPatch(agentReport, agentPatch);
      if (mergedAgent !== agentReport) changed = true;
      return mergedAgent;
    }),
  };

  const summary = normalizeText(patch.summary, 2000);
  if (summary && summary !== draftReport.summary) {
    report.summary = summary;
    changed = true;
  }

  if (!changed) return draftReport;

  const judgedAt = new Date().toISOString();
  report.systemPerformance = {
    ...draftReport.systemPerformance,
    reportGeneratedLocally: false,
    reportJudgeProvider: metadata.providerName || "external-report-judge",
  };
  report.reportJudge = {
    provider: metadata.providerName || "external-report-judge",
    modelName: metadata.modelName || null,
    promptVersion: metadata.promptVersion || null,
    judgedAt,
  };
  return report;
}

function recordProviderFailure(room, error) {
  if (!room || !room.runtimeMetrics) return;
  room.runtimeMetrics.llmErrors = Number(room.runtimeMetrics.llmErrors || 0) + 1;
  if (isTimeoutError(error)) {
    room.runtimeMetrics.timeouts = Number(room.runtimeMetrics.timeouts || 0) + 1;
  }
}

function isTimeoutError(error) {
  const name = String((error && error.name) || "").toLowerCase();
  const message = String((error && error.message) || "").toLowerCase();
  return name === "aborterror" || message.includes("timeout") || message.includes("timed out");
}

function extractReportPatch(response) {
  const candidate = response && typeof response === "object" && response.report ? response.report : response;
  if (!candidate || typeof candidate !== "object") return null;
  const agents = Array.isArray(candidate.agents)
    ? candidate.agents.filter((agent) => agent && agent.agentId)
    : [];
  if (!normalizeText(candidate.summary, 2000) && !agents.length) return null;
  return {
    summary: candidate.summary,
    agents,
  };
}

function mergeAgentReportPatch(agentReport, patch) {
  let changed = false;
  const merged = {
    ...agentReport,
    policyDiff: { ...agentReport.policyDiff },
    routingRecommendation: { ...agentReport.routingRecommendation },
  };

  const summary = normalizeText(patch.summary, 1200);
  if (summary && summary !== agentReport.summary) {
    merged.summary = summary;
    changed = true;
  }

  const failureModes = normalizeTextArray(patch.failureModes, 8, 120);
  if (failureModes.length) {
    merged.failureModes = failureModes;
    changed = true;
  }

  const policyRationale =
    normalizeText(patch.policyDiffRationale, 1200) ||
    normalizeText(patch.policyDiff && patch.policyDiff.rationale, 1200);
  if (policyRationale && policyRationale !== agentReport.policyDiff.rationale) {
    merged.policyDiff.rationale = policyRationale;
    changed = true;
  }

  const routePatch = patch.routingRecommendation || {};
  const routeReason = normalizeText(routePatch.reason, 1200);
  if (routeReason && routeReason !== agentReport.routingRecommendation.reason) {
    merged.routingRecommendation.reason = routeReason;
    changed = true;
  }

  const recommendedFor = normalizeTextArray(routePatch.recommendedFor, 8, 120);
  if (recommendedFor.length) {
    merged.routingRecommendation.recommendedFor = recommendedFor;
    changed = true;
  }

  const avoidFor = normalizeTextArray(routePatch.avoidFor, 8, 120);
  if (avoidFor.length) {
    merged.routingRecommendation.avoidFor = avoidFor;
    changed = true;
  }

  if (typeof routePatch.routeNextTime === "boolean") {
    merged.routingRecommendation.routeNextTime = routePatch.routeNextTime;
    changed = true;
  }

  return changed ? merged : agentReport;
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeTextArray(values, maxItems, maxLength) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => normalizeText(value, maxLength)).filter(Boolean).slice(0, maxItems);
}

function enrichExternalDecision(
  decision,
  room,
  triggerMessage,
  originalDecision,
  modelName,
  routingDecision = null,
) {
  const agent = agents.find((candidate) => candidate.id === decision.agentId);
  const route = routingDecision
    ? {
        routingDecisionId: routingDecision.id,
        routerVersion: routingDecision.routerVersion,
        routerModelName: routingDecision.routerModelName,
        roomType: routingDecision.roomType,
        groupState: routingDecision.groupState,
        selectedAgentId: routingDecision.selectedAgentId,
        reason: routingDecision.reason,
      }
    : decision.route;

  return {
    ...originalDecision,
    ...decision,
    id: decision.id || (originalDecision && originalDecision.id) || randomUUID(),
    roomId: room.id,
    triggerMessageId: triggerMessage.id,
    agentId: decision.agentId,
    agentName: decision.agentName || (originalDecision && originalDecision.agentName) || (agent && agent.name) || decision.agentId,
    targetUser:
      decision.targetUser === undefined
        ? originalDecision
          ? originalDecision.targetUser
          : null
        : decision.targetUser,
    reason: decision.reason || (originalDecision && originalDecision.reason) || "Model returned a route decision.",
    confidence: Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : 0,
    groupState: decision.groupState || room.currentGroupState || "active",
    roomType: decision.roomType || room.scenario.roomType,
    modelName: modelName || (agent && agent.modelName) || "external-model",
    promptVersion: (agent && agent.promptVersion) || (originalDecision && originalDecision.promptVersion) || null,
    policyVersion: (originalDecision && originalDecision.policyVersion) || null,
    route,
    createdAt: decision.createdAt || new Date().toISOString(),
  };
}

function enrichRoutingDecision(routingDecision, room, triggerMessage, decisions, modelName = null) {
  return {
    ...routingDecision,
    id: routingDecision.id || randomUUID(),
    roomId: room.id,
    triggerMessageId: triggerMessage.id,
    routerVersion: routingDecision.routerVersion || room.routerVersion,
    routerModelName: modelName,
    roomType: routingDecision.roomType || room.scenario.roomType,
    groupState: routingDecision.groupState || room.currentGroupState || "active",
    selectedAgentId: routingDecision.selectedAgentId || null,
    selectedAgentName: routingDecision.selectedAgentName || agentNameFor(routingDecision.selectedAgentId),
    reason: routingDecision.reason || "Model-assisted router selected this outcome.",
    candidateScores:
      routingDecision.candidateScores ||
      decisions.map((decision) => ({
        agentId: decision.agentId,
        agentName: decision.agentName,
        decision: decision.decision,
        confidence: decision.confidence,
        groupState: decision.groupState,
      })),
    blockedAgentIds:
      routingDecision.blockedAgentIds ||
      decisions
        .filter(
          (decision) =>
            routingDecision.selectedAgentId &&
            decision.agentId !== routingDecision.selectedAgentId &&
            decision.decision === "speak",
        )
        .map((decision) => decision.agentId),
    createdAt: routingDecision.createdAt || new Date().toISOString(),
  };
}

function agentNameFor(agentId) {
  if (!agentId) return null;
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent ? agent.name : agentId;
}

function parseOpenAIResponseJson(response) {
  if (response.output_parsed) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);

  const outputText = (response.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
  if (!outputText) throw new Error("OpenAI response did not include output text.");
  return JSON.parse(outputText);
}

function compactRoom(room) {
  return {
    id: room.id,
    scenario: room.scenario,
    selectedAgentIds: room.selectedAgentIds,
    policyMode: room.policyMode,
    currentPolicyVersion: room.currentPolicyVersion,
    routerVersion: room.routerVersion,
    currentGroupState: room.currentGroupState,
    recentMessages: room.messages.slice(-12),
    recentDecisions: room.decisions.slice(-12),
    recentRoutingDecisions: room.routingDecisions.slice(-6),
    feedback: room.feedback.slice(-40),
  };
}

module.exports = {
  HttpLlmProvider,
  LocalLlmProvider,
  OpenAIResponsesProvider,
  createLlmProvider,
  _internals: {
    isTimeoutError,
    normalizeDecisionResponse,
    normalizeRouteResponse,
    mergeJudgedReport,
    parseOpenAIResponseJson,
    recordProviderFailure,
    enrichExternalDecision,
    enrichRoutingDecision,
  },
};

const AGENT_DECISIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "agentId",
          "agentName",
          "decision",
          "targetUser",
          "reason",
          "confidence",
          "groupState",
          "roomType",
        ],
        properties: {
          agentId: { type: "string" },
          agentName: { type: "string" },
          decision: { type: "string", enum: ["speak", "stay_silent", "wait"] },
          targetUser: { type: ["string", "null"] },
          reason: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          groupState: { type: "string" },
          roomType: { type: "string" },
        },
      },
    },
  },
};

const ROUTING_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["routingDecision", "decisions"],
  properties: {
    routingDecision: {
      type: "object",
      additionalProperties: false,
      required: [
        "selectedAgentId",
        "selectedAgentName",
        "reason",
        "groupState",
        "roomType",
        "routerVersion",
      ],
      properties: {
        selectedAgentId: { type: ["string", "null"] },
        selectedAgentName: { type: ["string", "null"] },
        reason: { type: "string" },
        groupState: { type: "string" },
        roomType: { type: "string" },
        routerVersion: { type: "string" },
      },
    },
    decisions: AGENT_DECISIONS_SCHEMA.properties.decisions,
  },
};

const MESSAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
};

const REPORT_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "agents"],
  properties: {
    summary: { type: "string" },
    agents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "agentId",
          "summary",
          "failureModes",
          "policyDiffRationale",
          "routingRecommendation",
        ],
        properties: {
          agentId: { type: "string" },
          summary: { type: "string" },
          failureModes: {
            type: "array",
            items: { type: "string" },
          },
          policyDiffRationale: { type: "string" },
          routingRecommendation: {
            type: "object",
            additionalProperties: false,
            required: ["recommendedFor", "avoidFor", "routeNextTime", "reason"],
            properties: {
              recommendedFor: {
                type: "array",
                items: { type: "string" },
              },
              avoidFor: {
                type: "array",
                items: { type: "string" },
              },
              routeNextTime: { type: "boolean" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  },
};
