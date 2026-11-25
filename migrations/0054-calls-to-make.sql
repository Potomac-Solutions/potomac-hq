-- Calls to make (decision 0009, section 5): a call started from the list on
-- Today goes back to it when it ends, and the voicemail script read when
-- nobody answers, editable like the guides.
alter table call add column return_to text check (return_to is null or (substr(return_to, 1, 1) = '/' and substr(return_to, 2, 1) not in ('/', '\') and length(return_to) <= 200));

create table call_script (
  kind        text primary key check (kind in ('voicemail')),
  text        text not null check (length(trim(text)) between 1 and 600),
  updated_at  text not null,
  updated_by  text references user (id)
) strict;

insert into call_script (kind, text, updated_at) values
  ('voicemail', 'Hi {name}, this is {me} from Potomac Solutions, calling about {about}. Give me a call back when you get a chance, or I''ll try you again in a couple of days. Thanks!', '2026-11-25T00:00:00.000Z');
