-- Thanking the person who sent them (decision 0013, section 7): who
-- referred an opportunity, a client's own referral link, and the credit a
-- client earns when someone they referred pays their first invoice.
alter table opportunity add column referred_by_org text references client_organization (id);
alter table opportunity add column referred_by_name text check (referred_by_name is null or length(referred_by_name) between 1 and 100);

-- A referral link may belong to a client: their own, to give to friends.
alter table referral_link add column organization_id text references client_organization (id);
create unique index referral_link_by_organization on referral_link (organization_id) where organization_id is not null;

-- One credit for each client referred, to the client who referred them.
create table referral_credit (
  id            text primary key,
  referrer_id   text not null references client_organization (id),
  referred_id   text not null unique references client_organization (id),
  amount_minor  integer not null check (amount_minor > 0),
  earned_at     text not null
) strict;

create index referral_credit_by_referrer on referral_credit (referrer_id);

-- Credit taken off an invoice.
create table referral_credit_use (
  id            text primary key,
  referrer_id   text not null references client_organization (id),
  invoice_id    text not null references invoice (id),
  amount_minor  integer not null check (amount_minor > 0),
  used_by       text not null references user (id),
  used_at       text not null
) strict;

create index referral_credit_use_by_referrer on referral_credit_use (referrer_id);

-- What a referral is worth. One row; until it is set, $25.
create table referral_setting (
  id            integer primary key check (id = 1),
  credit_minor  integer not null check (credit_minor between 100 and 100000),
  updated_by    text not null references user (id),
  updated_at    text not null
) strict;
