# 90-Second Demo Script

## Setup

1. Open `/rooms/demo-room`.
2. Select `Weekend Trip Planning`.
3. Keep all three agents enabled.
4. Click `Run Sample`.

## Narration

SocialRL Arena is a realtime eval harness for multiplayer AI. The key question is not only what an agent says, but whether it should speak at all.

In this room, humans are planning a weekend trip. Each AI agent first makes a speak, wait, or stay-silent decision. The router then picks at most one agent for the turn.

Normal chat mode keeps the group-chat experience focused while still showing active participants, invite, end-session, report actions, and the end-of-session feedback prompt. Submitting feedback after the first report refreshes the latest Shape Report. The debug panel shows the participation decisions, confidence, group state, routing reason, selected Shape, blocked Shapes, candidate scores, and rule adjustments. The chat view lets humans tag AI messages with group-chat-native feedback like good timing, helped decide, interrupted, or should have stayed quiet.

When the session ends, the Shape Report scores each agent on timing, restraint, decision impact, social awareness, fun, and human-likeness. The agent-specific Shape page also shows quantitative stats, failure modes, best and worst messages with surrounding context, policy diffs, routing recommendations, and session-level feedback.

Now apply the improved policy and rerun the same scenario. The comparison shows whether the system reduced over-participation and improved decision usefulness.

The result is a working loop: live group chat, AI participation decisions, human feedback, performance reports, policy improvement, and routing recommendations.

## Capture Checklist

- Show normal chat view.
- Show agent decision stream.
- Show router candidate scores, selected Shape, blocked Shapes, and rule adjustments.
- Add at least two feedback tags.
- End session and show Shape Report.
- Click `Apply Improved`, run sample again, and show before/after comparison.
- Export JSON to show transcript/report portability.
