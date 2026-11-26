-- Decision 0015, section 4: the assistant on Home. Each person has one
-- running conversation: their messages, the assistant's answers and its
-- lookups, kept as the content blocks Claude's Messages API uses. "New chat"
-- archives what came before. Changes it proposes are actions: waiting for a
-- tap, done, cancelled, failed or undone. Nothing here changes a record by
-- itself; every change goes through the owning module's own service.
-- Numbered after #166's 0072 and 0073, which merge first.
create table assistant_message (
  id          text primary key,
  user_id     text not null references user (id),
  role        text not null check (role in ('user', 'assistant')),
  -- A JSON array of blocks: text, tool_use and tool_result.
  blocks      text not null check (json_valid(blocks) and json_type(blocks) = 'array'),
  archived    integer not null default 0 check (archived in (0, 1)),
  at          text not null
) strict;
create index assistant_message_by_user on assistant_message (user_id, archived, at);

create table assistant_action (
  id           text primary key,
  user_id      text not null references user (id),
  -- The tool_use block's id, so its answer can be told what came of it.
  tool_use_id  text not null,
  tool         text not null check (length(tool) between 1 and 40),
  input        text not null check (json_valid(input) and json_type(input) = 'object'),
  -- What the card says it will do, in words.
  summary      text not null check (length(summary) between 1 and 400),
  status       text not null check (status in ('waiting', 'done', 'cancelled', 'failed', 'undone')),
  -- After it ran: where to see it, why it failed, and how to undo it.
  href         text not null default '',
  problem      text not null default '' check (length(problem) <= 300),
  undo         text check (undo is null or json_valid(undo)),
  created_at   text not null,
  decided_at   text
) strict;
create index assistant_action_by_user on assistant_action (user_id, status, created_at);

-- Per person: let small changes go through without asking (off to start).
create table assistant_preference (
  user_id     text primary key references user (id),
  auto_small  integer not null default 0 check (auto_small in (0, 1)),
  updated_at  text not null
) strict;
