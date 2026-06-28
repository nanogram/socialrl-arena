create table if not exists rooms (
  id text primary key,
  scenario_id text not null,
  status text not null check (status in ('active', 'ended')),
  created_at timestamptz not null,
  ended_at timestamptz,
  current_policy_version text not null,
  router_version text not null,
  policy_mode text not null check (policy_mode in ('baseline', 'improved')),
  session_number integer not null default 1,
  selected_agent_ids text[] not null default '{}'
);

create table if not exists participants (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  display_name text not null,
  participant_type text not null check (participant_type in ('human', 'ai')),
  agent_id text,
  joined_at timestamptz not null
);

create table if not exists agents (
  id text primary key,
  name text not null,
  role text not null,
  base_personality text not null,
  participation_policy text not null,
  model_name text not null,
  version text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  sender_id text,
  sender_name text not null,
  sender_type text not null check (sender_type in ('human', 'ai')),
  agent_id text,
  content text not null,
  created_at timestamptz not null,
  reply_to_message_id text,
  decision_id text,
  latency_ms integer,
  first_token_latency_ms integer,
  token_count integer,
  model_name text,
  prompt_version text,
  policy_version text
);

create table if not exists agent_decisions (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  trigger_message_id text references messages(id) on delete set null,
  agent_id text not null,
  agent_name text not null,
  decision text not null check (decision in ('speak', 'stay_silent', 'wait')),
  target_user text,
  reason text not null,
  confidence double precision not null,
  group_state text not null,
  room_type text not null,
  model_name text,
  prompt_version text,
  policy_version text,
  route jsonb not null default '{}',
  created_at timestamptz not null
);

create table if not exists routing_decisions (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  trigger_message_id text references messages(id) on delete set null,
  router_version text not null,
  router_model_name text,
  room_type text not null,
  group_state text not null,
  selected_agent_id text,
  selected_agent_name text,
  reason text not null,
  candidate_scores jsonb not null,
  blocked_agent_ids text[] not null default '{}',
  created_at timestamptz not null
);

create table if not exists report_jobs (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  source text not null,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  queued_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  latency_ms integer,
  queue_depth_at_enqueue integer not null default 0,
  report_id text,
  error text
);

create table if not exists message_feedback (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  room_id text not null references rooms(id) on delete cascade,
  user_id text not null,
  tag text not null,
  label text not null,
  sentiment text not null check (sentiment in ('positive', 'negative', 'neutral')),
  created_at timestamptz not null
);

create table if not exists session_feedback (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  user_id text not null,
  most_useful_agent_id text,
  most_annoying_agent_id text,
  route_next_agent_id text,
  did_reach_decision boolean not null default false,
  would_invite_again boolean not null default false,
  humans_talked_more_or_less text not null,
  freeform_notes text,
  created_at timestamptz not null
);

create table if not exists agent_reports (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  agent_id text not null,
  session_number integer not null,
  policy_mode text not null,
  summary text not null,
  scorecard jsonb not null,
  stats jsonb not null,
  failure_modes jsonb not null,
  best_messages jsonb not null,
  worst_messages jsonb not null,
  routing_scores jsonb not null default '{}',
  policy_diff jsonb not null,
  routing_recommendation jsonb not null,
  created_at timestamptz not null
);

create table if not exists room_reports (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  session_number integer not null,
  policy_mode text not null,
  summary text not null,
  room_stats jsonb not null,
  session_feedback_summary jsonb not null,
  system_performance jsonb not null,
  comparison jsonb not null,
  created_at timestamptz not null
);

create table if not exists room_snapshots (
  room_id text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_room_created on messages(room_id, created_at);
create index if not exists idx_agent_decisions_room_created on agent_decisions(room_id, created_at);
create index if not exists idx_routing_decisions_room_created on routing_decisions(room_id, created_at);
create index if not exists idx_report_jobs_room_queued on report_jobs(room_id, queued_at);
create index if not exists idx_message_feedback_room on message_feedback(room_id);
create index if not exists idx_agent_reports_room on agent_reports(room_id, session_number);

alter table session_feedback add column if not exists route_next_agent_id text;
alter table agent_reports add column if not exists routing_scores jsonb not null default '{}';
alter table messages add column if not exists first_token_latency_ms integer;
