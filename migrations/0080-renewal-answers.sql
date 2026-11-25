-- The client answers a renewal in their portal: renew it, or let it lapse
-- (Mikey, 2026-11-25). Each answer is for one term: the renewal date it was
-- given for. Marking the renewal renewed moves the date on, so the next term
-- starts unanswered. Who answered is the client user signed in.
alter table renewal add column client_answer text check (client_answer is null or client_answer in ('renew', 'lapse'));
alter table renewal add column answered_for text check (answered_for is null or answered_for glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
alter table renewal add column answered_at text;
alter table renewal add column answered_by text references client_user (id);
