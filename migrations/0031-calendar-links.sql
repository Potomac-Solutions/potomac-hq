-- Calendar links: the private address of a calendar (Google, Outlook, Apple)
-- that HQ reads for busy times, so calls are never offered over them. The
-- address is a secret: whoever has it can read the calendar. It is shown to
-- nobody after it is saved, and never written to the activity log.
create table calendar_link (
  id          text primary key,
  label       text not null check (length(label) between 1 and 60),
  url         text not null check (length(url) between 12 and 2000),
  added_by    text not null references user (id),
  added_at    text not null,
  -- When it was last read, and what went wrong if it couldn't be.
  checked_at  text,
  problem     text not null default ''
) strict;
