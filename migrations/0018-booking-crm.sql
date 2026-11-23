-- A call booked from the public page, once added to the CRM: the client and
-- the opportunity it made (docs/data-model.md, "Booking").
alter table booking add column crm_client_id text references client_organization (id);
alter table booking add column crm_opportunity_id text references opportunity (id);
