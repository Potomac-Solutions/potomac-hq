-- Reviews and case studies (decision 0013, section 6). Nothing here leaves
-- HQ until it is published.
create table review_request (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  email            text not null check (length(email) between 3 and 254),
  token_hash       text not null unique,
  expires_at       text not null,
  used_at          text,
  created_by       text not null references user (id),
  created_at       text not null
) strict;

create table review (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  rating           integer not null check (rating between 1 and 5),
  text             text not null check (length(text) between 1 and 1000),
  display_name     text not null check (length(display_name) between 1 and 80),
  town             text not null default '' check (length(town) <= 80),
  may_publish      integer not null check (may_publish in (0, 1)),
  source           text not null check (source in ('client', 'phone', 'google', 'facebook', 'other')),
  status           text not null check (status in ('waiting', 'published', 'hidden')),
  request_id       text references review_request (id),
  published_at     text,
  created_at       text not null,
  updated_at       text not null,
  check (status <> 'published' or may_publish = 1)
) strict;

create index review_by_status on review (status, created_at);

create table case_study (
  id               text primary key,
  organization_id  text not null unique references client_organization (id),
  headline         text not null check (length(headline) between 1 and 120),
  problem          text not null default '' check (length(problem) <= 2000),
  built            text not null default '' check (length(built) <= 2000),
  result           text not null default '' check (length(result) <= 2000),
  live_url         text not null default '' check (length(live_url) <= 300),
  position         integer not null check (position between 1 and 999),
  published        integer not null check (published in (0, 1)),
  created_at       text not null,
  updated_at       text not null
) strict;

create table case_study_shot (
  id             text primary key,
  case_study_id  text not null references case_study (id) on delete cascade,
  content_type   text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes          blob not null,
  alt            text not null check (length(alt) between 1 and 200),
  position       integer not null,
  created_at     text not null
) strict;

create index case_study_shot_by_study on case_study_shot (case_study_id, position);

insert into role_permission (role_id, permission)
select role.id, 'review.manage' from role where role.key in ('admin', 'manager');
