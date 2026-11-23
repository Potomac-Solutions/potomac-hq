-- Change requests: work the client asks for beyond what was agreed, with its
-- price and hours. Potomac drafts and sends it; the client approves or
-- declines in the portal. An approval raises the project's budget and drafts
-- an invoice for the price.
create table change_request (
  id text primary key,
  project_id text not null references project (id),
  number integer not null check (number > 0),
  title text not null check (length(title) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  amount_minor integer not null check (amount_minor >= 0),
  minutes integer check (minutes is null or minutes > 0),
  status text not null check (status in ('draft', 'sent', 'approved', 'declined', 'withdrawn')),
  sent_at text,
  decided_at text,
  decided_by_client text references client_user (id),
  decided_by_user text references user (id),
  decision_note text not null default '' check (length(decision_note) <= 1000),
  invoice_id text references invoice (id),
  created_by text not null references user (id),
  created_at text not null,
  updated_at text not null,
  unique (project_id, number)
) strict;
create index change_request_by_project on change_request (project_id, number);
