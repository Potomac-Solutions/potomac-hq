-- Refunds (2026-11-26). Money given back on a payment: through the payment
-- platform (HQ asked it), or by hand (cash, a check, or at the platform's own
-- site, and HQ only records it). A payment's refunds never add up to more
-- than it was. An invoice's paid amount is its payments less their refunds.
create table payment_refund (
  id           text primary key,
  payment_id   text not null references payment (id),
  amount_minor integer not null check (amount_minor > 0),
  refunded_on  text not null check (refunded_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason       text not null default '' check (length(reason) <= 300),
  reference    text not null default '' check (length(reference) <= 100),
  through      text not null check (through in ('platform', 'by-hand')),
  recorded_by  text not null references user (id),
  created_at   text not null
) strict;

create index payment_refund_by_payment on payment_refund (payment_id);
