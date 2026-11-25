-- Decision 0011: social media. A client's plan (at most one), and the posts
-- and blog posts on each month's calendar, from a draft to the client's yes
-- to up on the networks. Seeing them is `social.view`, changing them
-- `social.edit`, for every role.
create table social_plan (
  id              text primary key,
  organization_id text not null unique references client_organization (id),
  -- JSON: [{ "network": "facebook", "pageUrl": "https://..." }], in the order Facebook, Instagram, LinkedIn.
  pages           text not null check (json_valid(pages) and json_array_length(pages) between 1 and 3),
  posts_per_month integer not null check (posts_per_month between 0 and 60),
  blogs_per_month integer not null check (blogs_per_month between 0 and 60),
  about           text not null default '' check (length(about) <= 2000),
  paused          integer not null check (paused in (0, 1)),
  created_at      text not null,
  updated_at      text not null
) strict;

create table social_post (
  id              text primary key,
  organization_id text not null references client_organization (id),
  kind            text not null check (kind in ('post', 'blog')),
  day             text not null check (day glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  month           text not null check (month = substr(day, 1, 7)),
  -- JSON array of networks. Empty for a blog post.
  networks        text not null check (json_valid(networks)),
  title           text not null default '' check (length(title) <= 120),
  words           text not null check (length(trim(words)) > 0 and length(words) <= 20000),
  link            text,
  picture         text not null default '' check (length(picture) <= 500),
  status          text not null check (status in ('draft', 'sent', 'changes', 'approved', 'posted', 'skipped')),
  sent_at         text,
  approved_at     text,
  approved_by     text check (approved_by is null or approved_by in ('client', 'staff', 'auto')),
  approval_note   text not null default '' check (length(approval_note) <= 1000),
  client_note     text not null default '' check (length(client_note) <= 1000),
  posted_at       text,
  -- JSON object: where it went up, by network or "blog".
  posted_links    text not null default '{}' check (json_valid(posted_links)),
  skip_reason     text not null default '' check (length(skip_reason) <= 1000),
  created_by      text references user (id),
  created_at      text not null,
  updated_at      text not null,
  check ((kind = 'blog' and length(trim(title)) > 0) or (kind = 'post' and title = ''))
) strict;
create index social_post_by_month on social_post (organization_id, month, day);
create index social_post_by_status on social_post (status, day);

insert into role_permission (role_id, permission) select role.id, 'social.view' from role where role.key in ('admin', 'manager', 'member');
insert into role_permission (role_id, permission) select role.id, 'social.edit' from role where role.key in ('admin', 'manager', 'member');
