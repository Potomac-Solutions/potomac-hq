-- The reminder emailed the day before a booked call, sent at most once.
alter table booking add column reminded_at text;
