-- Where a lead came from on the website (decision 0013, section 2): the
-- first `src`, page and campaign fields seen for each opportunity. Kept once;
-- later ones are ignored.
create table lead_touch (
  opportunity_id  text primary key references opportunity (id),
  src             text not null default '' check (length(src) <= 60),
  path            text not null default '' check (length(path) <= 200),
  utm_source      text not null default '' check (length(utm_source) <= 80),
  utm_medium      text not null default '' check (length(utm_medium) <= 80),
  utm_campaign    text not null default '' check (length(utm_campaign) <= 80),
  received_at     text not null
) strict;

create index lead_touch_by_src on lead_touch (src);
