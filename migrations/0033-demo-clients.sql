-- Demo clients: made-up businesses Potomac shows prospects (the demo apps),
-- kept apart from real work. They show with a Demo badge and are left out of
-- the dashboard's figures, Today, deadlines and reports.
alter table client_organization add column demo integer not null default 0 check (demo in (0, 1));
