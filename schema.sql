-- Run this once in your Supabase project's SQL Editor.
-- These tables are only ever touched by the backend bot, using the
-- service-role key — so RLS stays ON and locked to service-role, with no
-- anon-key policy at all. The frontend tracker never talks to these tables
-- directly.

create table if not exists whatsapp_groups (
  member_id text primary key,
  group_jid text unique not null,
  group_name text,
  created_at timestamptz default now()
);
alter table whatsapp_groups enable row level security;
-- no policies added on purpose: only the service-role key (used by the bot)
-- can bypass RLS and access this table. The anon key gets nothing.

create table if not exists whatsapp_messages (
  id bigserial primary key,
  group_jid text not null,
  sender text not null,
  sender_name text,
  body text not null,
  msg_ts timestamptz not null,
  created_at timestamptz default now()
);
alter table whatsapp_messages enable row level security;

create index if not exists whatsapp_messages_group_ts_idx
  on whatsapp_messages (group_jid, msg_ts);
