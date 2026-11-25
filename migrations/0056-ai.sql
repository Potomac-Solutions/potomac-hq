-- Decision 0010: AI assistance. One row of settings (the model and its prices,
-- the monthly budget, which features are on, and the price guide lead triage
-- reads), a log of every call with what it cost, and the drafts AI writes,
-- which a person uses or discards. The API key is never stored here: it is
-- HQ_ANTHROPIC_API_KEY on the server.
create table ai_setting (
  id            integer primary key check (id = 1),
  model         text not null check (length(model) between 3 and 80),
  -- Millionths of a dollar per million tokens.
  input_price   integer not null check (input_price >= 0),
  output_price  integer not null check (output_price >= 0),
  -- A dearer rate past `long_above` input tokens (Haiku 5.5), or null.
  long_above    integer,
  long_input    integer,
  long_output   integer,
  budget_minor  integer not null check (budget_minor between 0 and 100000),
  features      text not null check (json_valid(features) and json_type(features) = 'array'),
  price_guide   text not null default '' check (length(price_guide) <= 4000),
  updated_by    text references user (id),
  updated_at    text not null
) strict;

-- Mikey's choices on 2026-11-25: Claude Haiku 5.5 and $20 a month. Every
-- feature starts off. The price guide is Potomac's launch prices.
insert into ai_setting (id, model, input_price, output_price, long_above, long_input, long_output, budget_minor, features, price_guide, updated_by, updated_at)
values (1, 'claude-haiku-5-5', 100000, 500000, 100000, 500000, 2500000, 2000, '[]',
'Consulting: the first 30 minutes are free, then $75 an hour.
Landing page: one informational landing page, free for good, hosted at a *.potomac.solutions address. Four rounds of changes and a final approval are free; after that $50 an hour, or a quote for bigger work.
Domain names: the domain''s own cost plus $10 a year.
Multi-page website with unlimited support and updates: $50 a month or $500 a year.
Social media (Facebook, Instagram, LinkedIn content, and blog writing): $50 a month or $500 a year.
Application development: about $1,000 to $5,000, depending on how big and complex it is. Quoted after the free call.
Automations (n8n): quoted after the free call.
Deposits are one third of the quote.',
null, '2026-11-25T00:00:00Z');

-- Every call to the model, kept for the usage page and the budget. Counts are
-- of tokens; cost is in millionths of a dollar.
create table ai_usage (
  id            text primary key,
  feature       text not null,
  record_type   text not null,
  record_id     text not null,
  model         text not null,
  input_count   integer not null check (input_count >= 0),
  output_count  integer not null check (output_count >= 0),
  cost          integer not null check (cost >= 0),
  actor_id      text references user (id),
  at            text not null,
  ok            integer not null check (ok in (0, 1)),
  problem       text not null default '' check (length(problem) <= 200),
  draft_id      text
) strict;
create index ai_usage_by_time on ai_usage (at);

-- What AI wrote, waiting for a person: used, or discarded. `content` is the
-- feature's JSON. `fingerprint` says which records it was written from, so a
-- page can tell when they've changed since. A receipt's picture is kept only
-- until the draft is used or discarded.
create table ai_draft (
  id               text primary key,
  feature          text not null,
  record_type      text not null,
  record_id        text not null,
  content          text not null check (json_valid(content)),
  status           text not null check (status in ('waiting', 'used', 'discarded')),
  fingerprint      text not null default '',
  attachment       blob,
  attachment_name  text,
  created_by       text references user (id),
  created_at       text not null,
  decided_by       text references user (id),
  decided_at       text
) strict;
create index ai_draft_by_record on ai_draft (feature, record_id, created_at);
create index ai_draft_waiting on ai_draft (created_at) where status = 'waiting';
create index ai_draft_by_fingerprint on ai_draft (feature, fingerprint);

insert into role_permission (role_id, permission) select role.id, 'ai.manage' from role where role.key = 'admin';
