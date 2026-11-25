-- Decision 0012, answered by Mikey on 2026-11-25: one budget for everything
-- HQ asks Claude. The site builder's cap becomes that budget, shared with
-- the AI drafts, at the $20 a month he set for them; it is changed under
-- Site builder → Model and cap. The AI drafts' own budget goes.
update builder_settings set cap_cents = 2000 where id = 1;
alter table ai_setting drop column budget_minor;
