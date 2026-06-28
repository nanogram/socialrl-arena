# Evaluating AI as a Group-Chat Participant, Not a Chatbot

SocialRL Arena is a realtime eval harness for multiplayer AI. It tests not only what an agent says, but whether it should speak, who it should respond to, and whether its participation improves the group dynamic.

The demo centers on live human + AI rooms. Humans chat normally while AI agents run a two-step participation process: first each agent decides whether to speak, wait, or stay silent and who it is targeting; then the router selects at most one agent/model/policy for the turn. This creates measurable restraint instead of a bot that replies to every message.

The product loop is:

1. Create a room and select a scenario.
2. Join with a display name and add AI agents with distinct roles: Mediator, Vibe Friend, and Observer.
3. Run a realtime group chat with streamed AI responses.
4. Let humans tag AI messages with social feedback.
5. End the session and generate an Agent Performance Report.
6. Apply the generated improved policy.
7. Rerun the scenario and compare baseline vs improved behavior.

The feedback model is group-chat-native. It captures common message quality labels plus whether the agent helped the group decide, interrupted humans, had good timing, should have stayed quiet, reduced tension, made the chat fun, missed social tension, responded to the wrong person, became too generic, or ignored a quieter participant. Reply-to metadata preserves which message a human or AI response targeted, and reports quantify reply-targeting rate, target-user counts, wrong-person feedback, and quiet-participant targeting so reviewers can evaluate whether the agent understood who was talking to whom. Session feedback also records which agent users would route into this type of room next time.

Agent Performance Reports score each agent on helpfulness, timing, brevity, personality consistency, social awareness, group momentum, decision impact, human-likeness, fun, and restraint. Reports include a participation decision review that ties recent speak, wait, and stay-silent decisions back to trigger messages, target users, router selection, rule adjustments, and feedback outcomes. They also include best and worst messages, failure modes, policy diffs, routing recommendations, targeting metrics, human momentum lift/direction, routing success and suitability scores, session feedback summaries, system performance metrics, and an evidence manifest covering transcript, decisions, feedback, latency samples, agent config, scenario metadata, and archived before/after runs.

The technical architecture includes a Node WebSocket server, browser chat/eval UI with a normal-chat/debug-view toggle plus active participant and policy panels, deterministic local agents, optional OpenAI Responses integration with per-stage model routing, optional generic HTTP LLM integration, an optional external report judge, file-backed local persistence, Postgres schema and normalized writes, JSON export with sender/reply/latency/token/model metadata, realtime debug events for speak/wait/stay-silent decisions, and a synthetic load-test harness. The scenario catalog covers the routing room types from the spec: planning, drama/conflict, casual hangout, fandom/RP, study/work, advice, game night, debate, and support/emotional rooms.

The router is intentionally visible. In the local policy, planning rooms with a decision-needed state prefer Mediator, tense or emotionally sensitive rooms block Vibe Friend in favor of Observer or Mediator, chaotic side threads route toward a quiet reset, stalled rooms can route Vibe Friend for low-stakes energy, playful high-momentum rooms require high Vibe Friend confidence, and repeated “should have stayed quiet” or interruption feedback raises an agent’s restraint threshold. Each routed turn also records the model tier plan: fast models for classification, speak decisions, routing, and feedback aggregation; stronger models for emotionally complex responses, reports, policy generation, and nuanced policy repair.

The strongest demo is a before/after run. In the baseline, agents tend to speak too often or over-summarize. After feedback, the report generates policy diffs that are carried into the improved run, raising the speak threshold, shortening messages, and making the router more selective. The reviewer can see a side-by-side comparison of baseline and improved message counts, timing feedback, restraint scores, and “helped us decide” rates, while the export preserves both run transcripts, decisions, feedback, and reports for review.

This demonstrates that AI participation quality in group chat can be measured, reviewed, and improved.
