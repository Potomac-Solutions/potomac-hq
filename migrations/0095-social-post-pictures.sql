-- Decision 0011, slice 3: the picture itself. A post's picture is a file in
-- the file service (decision 0002). The post's `picture` text still says what
-- it shows. Null until a picture is uploaded; removing one clears it.
alter table social_post add column picture_file_id text references file (id);
