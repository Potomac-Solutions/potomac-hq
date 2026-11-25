-- The recap email (decision 0009, section 7): when a call's recap was sent,
-- so it's sent once and the call screen can say so.
alter table call add column recap_sent_at text;
