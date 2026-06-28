# 90-Second Demo Script

## Setup

1. Open `/rooms/demo-room`.
2. Optionally open `/` first to show the landing page, then use `/create` for room setup.
3. Show the scenario list, which covers planning, conflict, casual hangout, fandom/RP, study/work, advice, game night, debate, and support/emotional rooms, then select `Weekend Trip Planning`.
4. Keep all three agents enabled.
5. Click `Run Sample`.

## Narration

SocialRL Arena is a realtime eval harness for multiplayer AI. The key question is not only what an agent says, but whether it should speak at all.

In this room, humans are planning a weekend trip. Each AI agent first makes a speak, wait, or stay-silent decision. The router then picks at most one agent for the turn.

Normal chat mode keeps the group-chat experience focused while still showing active participants, invite, end-session, report actions, and the end-of-session feedback prompt. Humans can reply to a specific message, and AI responses preserve the trigger-message link so reviewers can see who or what the Shape responded to. Submitting feedback after the first report refreshes the latest Shape Report. The debug panel shows the participation decisions, confidence, group state, target user, routing reason, selected Shape, blocked Shapes, candidate scores, and rule adjustments. The chat view lets humans tag AI messages with group-chat-native feedback like good timing, helped decide, interrupted, responded to the wrong person, or should have stayed quiet.

When the session ends, the Shape Report scores each agent on timing, restraint, decision impact, social awareness, fun, and human-likeness. The report also shows reply-targeting, target-user, wrong-person, quiet-participant targeting, and human momentum lift stats, plus model-routing evidence: fast tiers for classification, speak decisions, routing, and feedback aggregation, and strong tiers for reports, policy repair, and emotionally complex or conflict-heavy responses. The Eval Inputs card summarizes the transcript, decisions, feedback, latency samples, agent configs, and archived runs used by the report worker. The agent-specific Shape page also shows quantitative stats, the participation decision review, failure modes, best and worst messages with surrounding context, policy diffs, routing recommendations, and session-level feedback.

Now apply the improved policy and rerun the same scenario. The comparison shows whether the system reduced over-participation and improved decision usefulness.

The result is a working loop: live group chat, AI participation decisions, human feedback, performance reports, policy improvement, and routing recommendations.

## Capture Checklist

- Show normal chat view.
- Show the landing page and create-room page.
- Reply to a specific message and show the reply context.
- Show agent decision stream.
- Show target-user and reply-targeting stats in a Shape report.
- Show router candidate scores, selected Shape, blocked Shapes, and rule adjustments.
- Show the model-routing card in the report.
- Show the report's participation decision review for one Shape.
- Add at least two feedback tags.
- End session and show Shape Report.
- Click `Apply Improved`, run sample again, and show before/after comparison.
- Export JSON to show transcript/report portability, including archived baseline and improved run snapshots plus sender, latency, token, model, prompt, and policy metadata.
