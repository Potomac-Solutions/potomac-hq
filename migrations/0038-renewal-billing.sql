-- Billing a client for a renewal (docs/decisions/0006-renewal-billing.md):
-- the invoice last sent for it, and the renewal date that invoice was for,
-- so HQ knows whether the coming term is billed and paid.
alter table renewal add column invoice_id text references invoice (id);
alter table renewal add column billed_for text check (billed_for is null or billed_for glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
