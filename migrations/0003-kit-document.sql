-- Storage for the Potomac kit's staff module: accounts, sessions and one-time
-- link tokens (docs/data-model.md, "Storage for the kit"). The kit reads and
-- writes it through a store adapter. No HQ code reads it directly.

create table kit_document (
  collection text not null check (length(collection) > 0),
  key        text not null check (length(key) > 0),
  fields     text not null check (json_valid(fields) and json_type(fields) = 'object'),
  primary key (collection, key)
) strict, without rowid;
