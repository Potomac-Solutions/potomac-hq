-- The dearest model anyone may pick when they ask Claude for one draft or
-- one site builder request (Mikey, 2026-11-25). Settings → AI sets it; the
-- usual model stays what HQ's own jobs use and what every form starts on.
-- Opus 5.5 to start: the site builder's default, so nothing it did changes.
alter table ai_setting add column ceiling text not null default 'claude-opus-5-5' check (length(ceiling) between 3 and 80);
