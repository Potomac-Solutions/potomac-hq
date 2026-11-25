-- Call guides (decision 0009, section 2): the questions to work through on a
-- call, one guide for each kind of call, editable with knowledge.edit; and
-- each call's answers, with the question as it was asked, so changing a guide
-- never changes a call already made.
create table call_guide (
  situation   text primary key check (situation in ('first-call', 'proposal-follow-up', 'project-check-in', 'renewal', 'any')),
  title       text not null check (length(trim(title)) between 1 and 80),
  updated_at  text not null,
  updated_by  text references user (id)
) strict;

create table call_guide_question (
  situation  text not null references call_guide (situation),
  position   integer not null check (position between 1 and 20),
  text       text not null check (length(trim(text)) between 1 and 200),
  primary key (situation, position)
) strict;

alter table call add column guide text check (guide is null or guide in ('first-call', 'proposal-follow-up', 'project-check-in', 'renewal', 'any'));

-- Answers are kept per guide, so switching guides mid-call loses nothing.
create table call_answer (
  call_id   text not null references call (id),
  guide     text not null check (guide in ('first-call', 'proposal-follow-up', 'project-check-in', 'renewal', 'any')),
  position  integer not null check (position between 1 and 20),
  question  text not null check (length(question) between 1 and 200),
  asked     integer not null check (asked in (0, 1)),
  answer    text not null default '' check (length(answer) <= 1000),
  primary key (call_id, guide, position)
) strict;

insert into call_guide (situation, title, updated_at) values
  ('first-call', 'First call', '2026-11-25T00:00:00.000Z'),
  ('proposal-follow-up', 'Proposal follow-up', '2026-11-25T00:00:00.000Z'),
  ('project-check-in', 'Project check-in', '2026-11-25T00:00:00.000Z'),
  ('renewal', 'Renewal', '2026-11-25T00:00:00.000Z'),
  ('any', 'Any call', '2026-11-25T00:00:00.000Z');

insert into call_guide_question (situation, position, text) values
  ('first-call', 1, 'What does the business do, and who are its customers?'),
  ('first-call', 2, 'How do customers find you now?'),
  ('first-call', 3, 'What isn''t working, or what made you reach out?'),
  ('first-call', 4, 'What would a good result look like in six months?'),
  ('first-call', 5, 'Roughly what budget do you have in mind?'),
  ('first-call', 6, 'When do you need it by?'),
  ('first-call', 7, 'Who else has a say in the decision?'),
  ('proposal-follow-up', 1, 'What did you think of the proposal?'),
  ('proposal-follow-up', 2, 'Any questions about what''s included, or the price?'),
  ('proposal-follow-up', 3, 'Is anything in the way of going ahead?'),
  ('proposal-follow-up', 4, 'When will you decide?'),
  ('project-check-in', 1, 'How is it going, from your side?'),
  ('project-check-in', 2, 'Is there anything you''re waiting on from us?'),
  ('project-check-in', 3, 'Can we get what we''re waiting on from you?'),
  ('project-check-in', 4, 'Anything you''d like changed? (Each one can be a change request.)'),
  ('project-check-in', 5, 'Are we still on track for the next milestone?'),
  ('renewal', 1, 'Do you still want it to renew?'),
  ('renewal', 2, 'Anything you''d like to change about it?'),
  ('renewal', 3, 'How would you like to pay?'),
  ('any', 1, 'Why did they call, or why did we?'),
  ('any', 2, 'What do they need?'),
  ('any', 3, 'What''s the next step, and who takes it?');
