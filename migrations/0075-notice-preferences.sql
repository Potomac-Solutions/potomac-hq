-- Notice settings (quality of life, Mikey 2026-11-25): for each kind of
-- notice, whether it is emailed right away, in a morning digest or never,
-- and quiet hours when nothing is sent (it waits until they end). The bell
-- in HQ always shows every notice. Hours are 0 to 23 in Potomac's time zone;
-- both null means no quiet hours.
alter table notice_setting add column assigned text not null default 'now' check (assigned in ('now', 'daily', 'never'));
alter table notice_setting add column mentioned text not null default 'now' check (mentioned in ('now', 'daily', 'never'));
alter table notice_setting add column reminder text not null default 'now' check (reminder in ('now', 'daily', 'never'));
alter table notice_setting add column quiet_from integer check (quiet_from is null or quiet_from between 0 and 23);
alter table notice_setting add column quiet_to integer check (quiet_to is null or quiet_to between 0 and 23);
