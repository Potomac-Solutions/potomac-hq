# Migrations

The schema changes only through the files in this folder.

- Name each file `NNNN-short-name.sql`, numbered from `0001` with no gaps.
- A file runs once, in its own transaction.
- Never edit a file after it has been applied anywhere. The runner compares
  checksums and refuses to start. Fix a mistake with a new migration.
- There are no down migrations. Recovery is a restore from backup.

Run them with `HQ_DATABASE_PATH=data/hq.db npm run migrate`.
