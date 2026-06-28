const fs = require("fs/promises");
const path = require("path");
const { agents, hydrateRoom, serializeRoom } = require("./core");

function createStorage() {
  if (process.env.SOCIALRL_STORAGE === "memory") {
    return new MemoryStorage();
  }

  if (process.env.DATABASE_URL) {
    return new PostgresStorage(process.env.DATABASE_URL);
  }

  const filePath =
    process.env.SOCIALRL_STORAGE_FILE || path.join(__dirname, "..", "data", "rooms.json");
  return new FileStorage(filePath);
}

class MemoryStorage {
  constructor() {
    this.name = "memory";
    this.rooms = new Map();
  }

  async loadRooms() {
    return roomsFromSnapshots([...this.rooms.values()]);
  }

  async saveRoom(room) {
    this.rooms.set(room.id, serializeForStorage(room));
  }

  async saveRooms(rooms) {
    rooms.forEach((room) => this.rooms.set(room.id, serializeForStorage(room)));
  }

  async close() {}
}

class FileStorage {
  constructor(filePath) {
    this.name = "file";
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async loadRooms() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return roomsFromSnapshots(parsed.rooms || []);
    } catch (error) {
      if (error.code === "ENOENT") return new Map();
      throw error;
    }
  }

  async saveRoom(room) {
    await this.saveRooms(new Map([[room.id, room]]), { merge: true });
  }

  async saveRooms(rooms, options = {}) {
    this.writeQueue = this.writeQueue.then(async () => {
      const nextRooms = options.merge ? await this.loadRooms() : new Map();
      rooms.forEach((room, roomId) => nextRooms.set(roomId, room));
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(
          {
            version: 1,
            savedAt: new Date().toISOString(),
            rooms: [...nextRooms.values()].map(serializeForStorage),
          },
          null,
          2,
        ),
      );
    });

    return this.writeQueue;
  }

  async close() {}
}

class PostgresStorage {
  constructor(connectionString) {
    const { Pool } = require("pg");
    this.name = "postgres";
    this.pool = new Pool({ connectionString });
  }

  async loadRooms() {
    const client = await this.pool.connect();
    try {
      await ensurePostgresSchema(client);
      const result = await client.query("select snapshot from room_snapshots order by updated_at asc");
      return roomsFromSnapshots(result.rows.map((row) => row.snapshot));
    } finally {
      client.release();
    }
  }

  async saveRoom(room) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await ensurePostgresSchema(client);
      await client.query("begin");
      inTransaction = true;
      await replaceNormalizedRoom(client, room);
      await upsertSnapshot(client, room);
      await client.query("commit");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveRooms(rooms) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await ensurePostgresSchema(client);
      await client.query("begin");
      inTransaction = true;
      for (const room of rooms.values()) {
        await replaceNormalizedRoom(client, room);
        await upsertSnapshot(client, room);
      }
      await client.query("commit");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

async function ensureSnapshotTable(client) {
  await client.query(`
    create table if not exists room_snapshots (
      room_id text primary key,
      snapshot jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

async function ensurePostgresSchema(client) {
  const schemaSql = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await client.query(schemaSql);
}

async function replaceNormalizedRoom(client, room) {
  const snapshot = serializeRoom(room);

  await upsertAgents(client);
  await client.query(
    `
      insert into rooms (
        id, scenario_id, status, created_at, ended_at, current_policy_version,
        router_version, policy_mode, session_number, selected_agent_ids
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (id) do update set
        scenario_id = excluded.scenario_id,
        status = excluded.status,
        ended_at = excluded.ended_at,
        current_policy_version = excluded.current_policy_version,
        router_version = excluded.router_version,
        policy_mode = excluded.policy_mode,
        session_number = excluded.session_number,
        selected_agent_ids = excluded.selected_agent_ids
    `,
    [
      room.id,
      room.scenario.id,
      room.status,
      room.createdAt,
      room.endedAt,
      room.currentPolicyVersion,
      room.routerVersion,
      room.policyMode,
      room.sessionNumber,
      room.selectedAgentIds,
    ],
  );

  await deleteRoomChildren(client, room.id);
  await insertParticipants(client, room.id, participantRowsForRoom(room, snapshot.participants));
  await insertMessages(client, snapshot.messages);
  await insertRoutingDecisions(client, snapshot.routingDecisions);
  await insertAgentDecisions(client, snapshot.decisions);
  await insertReportJobs(client, snapshot.reportJobs);
  await insertMessageFeedback(client, snapshot.feedback);
  await insertSessionFeedback(client, snapshot.sessionFeedback);
  await insertReports(client, snapshot.reports);
}

async function upsertAgents(client) {
  for (const agent of agents) {
    await client.query(
      `
        insert into agents (
          id, name, role, base_personality, participation_policy, model_name, version
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update set
          name = excluded.name,
          role = excluded.role,
          base_personality = excluded.base_personality,
          participation_policy = excluded.participation_policy,
          model_name = excluded.model_name,
          version = excluded.version
      `,
      [
        agent.id,
        agent.name,
        agent.role,
        agent.basePersonality,
        agent.baselinePolicy,
        agent.modelName,
        agent.version,
      ],
    );
  }
}

async function deleteRoomChildren(client, roomId) {
  const tables = [
    "agent_reports",
    "room_reports",
    "session_feedback",
    "message_feedback",
    "report_jobs",
    "agent_decisions",
    "routing_decisions",
    "messages",
    "participants",
  ];

  for (const table of tables) {
    await client.query(`delete from ${table} where room_id = $1`, [roomId]);
  }
}

async function insertParticipants(client, roomId, participants) {
  for (const participant of participants) {
    await client.query(
      `
        insert into participants (
          id, room_id, display_name, participant_type, agent_id, joined_at
        )
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        participant.id,
        roomId,
        participant.displayName,
        participant.participantType,
        participant.agentId || null,
        participant.joinedAt,
      ],
    );
  }
}

function participantRowsForRoom(room, humanParticipants) {
  const aiParticipants = room.selectedAgentIds.map((agentId) => {
    const agent = agents.find((candidate) => candidate.id === agentId);
    return {
      id: `${room.id}:agent:${agentId}`,
      displayName: agent ? agent.name : agentId,
      participantType: "ai",
      agentId,
      joinedAt: room.createdAt,
    };
  });

  return [...humanParticipants, ...aiParticipants];
}

async function insertMessages(client, messages) {
  for (const message of messages) {
    await client.query(
      `
        insert into messages (
          id, room_id, sender_id, sender_name, sender_type, agent_id, content,
          created_at, reply_to_message_id, decision_id, latency_ms, first_token_latency_ms, token_count,
          model_name, prompt_version, policy_version
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        message.id,
        message.roomId,
        null,
        message.senderName,
        message.senderType,
        message.agentId,
        message.content,
        message.createdAt,
        message.replyToMessageId,
        message.decisionId,
        message.latencyMs,
        message.firstTokenLatencyMs,
        message.tokenCount,
        message.modelName,
        message.promptVersion,
        message.policyVersion,
      ],
    );
  }
}

async function insertAgentDecisions(client, decisions) {
  for (const decision of decisions) {
    await client.query(
      `
        insert into agent_decisions (
          id, room_id, trigger_message_id, agent_id, agent_name, decision, target_user,
          reason, confidence, group_state, room_type, model_name, prompt_version,
          policy_version, route, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
      `,
      [
        decision.id,
        decision.roomId,
        decision.triggerMessageId,
        decision.agentId,
        decision.agentName,
        decision.decision,
        decision.targetUser,
        decision.reason,
        decision.confidence,
        decision.groupState,
        decision.roomType,
        decision.modelName,
        decision.promptVersion,
        decision.policyVersion,
        JSON.stringify(decision.route || {}),
        decision.createdAt,
      ],
    );
  }
}

async function insertRoutingDecisions(client, routingDecisions) {
  for (const decision of routingDecisions) {
    await client.query(
      `
        insert into routing_decisions (
          id, room_id, trigger_message_id, router_version, router_model_name,
          room_type, group_state, selected_agent_id, selected_agent_name, reason,
          candidate_scores, blocked_agent_ids, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
      `,
      [
        decision.id,
        decision.roomId,
        decision.triggerMessageId,
        decision.routerVersion,
        decision.routerModelName || null,
        decision.roomType,
        decision.groupState,
        decision.selectedAgentId || null,
        decision.selectedAgentName || null,
        decision.reason,
        JSON.stringify(decision.candidateScores || []),
        decision.blockedAgentIds || [],
        decision.createdAt,
      ],
    );
  }
}

async function insertReportJobs(client, reportJobs) {
  for (const job of reportJobs) {
    await client.query(
      `
        insert into report_jobs (
          id, room_id, source, status, queued_at, started_at, completed_at,
          latency_ms, queue_depth_at_enqueue, report_id, error
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        job.id,
        job.roomId,
        job.source,
        job.status,
        job.queuedAt,
        job.startedAt || null,
        job.completedAt || null,
        job.latencyMs === undefined ? null : job.latencyMs,
        job.queueDepthAtEnqueue || 0,
        job.reportId || null,
        job.error || null,
      ],
    );
  }
}

async function insertMessageFeedback(client, feedback) {
  for (const entry of feedback) {
    await client.query(
      `
        insert into message_feedback (
          id, message_id, room_id, user_id, tag, label, sentiment, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        entry.id,
        entry.messageId,
        entry.roomId,
        entry.userId,
        entry.tag,
        entry.label,
        entry.sentiment,
        entry.createdAt,
      ],
    );
  }
}

async function insertSessionFeedback(client, feedback) {
  for (const entry of feedback) {
    await client.query(
      `
        insert into session_feedback (
          id, room_id, user_id, most_useful_agent_id, most_annoying_agent_id,
          route_next_agent_id, did_reach_decision, would_invite_again,
          humans_talked_more_or_less, freeform_notes, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        entry.id,
        entry.roomId,
        entry.userId,
        entry.mostUsefulAgentId,
        entry.mostAnnoyingAgentId,
        entry.routeNextAgentId || null,
        entry.didReachDecision,
        entry.wouldInviteAgain,
        entry.humansTalkedMoreOrLess,
        entry.freeformNotes,
        entry.createdAt,
      ],
    );
  }
}

async function insertReports(client, reports) {
  for (const report of reports) {
    await client.query(
      `
        insert into room_reports (
          id, room_id, session_number, policy_mode, summary, room_stats,
          session_feedback_summary, system_performance, comparison, created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
      `,
      [
        report.id,
        report.roomId,
        report.sessionNumber,
        report.policyMode,
        report.summary,
        JSON.stringify(report.roomStats),
        JSON.stringify(report.sessionFeedbackSummary),
        JSON.stringify(report.systemPerformance),
        JSON.stringify(report.comparison || []),
        report.createdAt,
      ],
    );

    for (const agentReport of report.agents || []) {
      await client.query(
        `
          insert into agent_reports (
            id, room_id, agent_id, session_number, policy_mode, summary, scorecard,
            stats, failure_modes, best_messages, worst_messages, routing_scores,
            policy_diff, routing_recommendation, created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15)
        `,
        [
          `${report.id}:${agentReport.agentId}`,
          report.roomId,
          agentReport.agentId,
          report.sessionNumber,
          report.policyMode,
          agentReport.summary,
          JSON.stringify(agentReport.scorecard),
          JSON.stringify(agentReport.stats),
          JSON.stringify(agentReport.failureModes),
          JSON.stringify(agentReport.bestMessages),
          JSON.stringify(agentReport.worstMessages),
          JSON.stringify(agentReport.routingScores || {}),
          JSON.stringify(agentReport.policyDiff),
          JSON.stringify(agentReport.routingRecommendation),
          report.createdAt,
        ],
      );
    }
  }
}

async function upsertSnapshot(client, room) {
  await client.query(
    `
      insert into room_snapshots (room_id, snapshot, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (room_id)
      do update set snapshot = excluded.snapshot, updated_at = now()
    `,
    [room.id, JSON.stringify(serializeForStorage(room))],
  );
}

function roomsFromSnapshots(snapshots) {
  const rooms = new Map();
  snapshots.forEach((snapshot) => {
    const room = hydrateRoom(snapshot);
    rooms.set(room.id, room);
  });
  return rooms;
}

function serializeForStorage(room) {
  const snapshot = serializeRoom(room);
  delete snapshot.scenarios;
  delete snapshot.availableAgents;
  delete snapshot.agents;
  delete snapshot.feedbackDefinitions;
  return snapshot;
}

module.exports = {
  FileStorage,
  MemoryStorage,
  PostgresStorage,
  createStorage,
  _internals: {
    replaceNormalizedRoom,
    serializeForStorage,
  },
};
