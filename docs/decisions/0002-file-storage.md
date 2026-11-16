# 0002. Where uploaded files are kept

Status: decided 2026-11-16 while Mikey was away. Needs his approval. Decided
by: Claude, under "roll until it is ready to deploy".

## Context

v0.3 adds deliverables, and v0.5 adds receipts. The roadmap asks for a file
service that stores files outside the web root, authorizes every download on
the server, and records uploads and downloads.

**This departs from two approved documents.** Decision 0001's table says
"File storage and backup copies: Cloudflare R2", and `docs/tool-boundaries.md`
says "Cloudflare R2 holds the bytes". The plan's status note of November 15
lists file storage as still open. With Mikey away, and no R2 keys set, the
choice below was made so that uploads work the day HQ is deployed. If he
prefers R2 for the bytes, as first written, the change is one adapter.

Three facts shaped the choice:

1. HQ runs as one container on Railway with one volume, holding one SQLite
   file.
2. The nightly backup seals a copy of that one file and sends it to R2. A
   restore is one file.
3. The volume of files is small: one developer's deliverables and receipts,
   each capped at 25 MB.

## Decision

A file's bytes are kept in the database, in the `file_blob` table, next to
its record in `file`.

| Question | Answer |
| --- | --- |
| Outside the web root | Yes. There is no folder to serve. A file has no address but `/files/<id>`, which goes through the file service |
| Backed up | Yes, with everything else, sealed, by the backup that already exists |
| Restored | Yes, by the same restore. A restored HQ has every deliverable and receipt |
| Limit | 25 MB a file. Types are a fixed list, checked against the file's first bytes |

The application layer talks to a `BlobStore` port with two functions, `put`
and `get`. The SQLite adapter is the only one today.

## Consequences

- The database file and each nightly backup grow by the size of every file
  uploaded. At a few hundred megabytes this costs nothing that matters. The
  backup is read into memory to seal it, so it should move to R2 before the
  database nears a gigabyte.
- Moving to R2 later means writing one adapter for `BlobStore` and a command
  that copies the rows out. `BlobStore` is called inside a database
  transaction, and R2 is reached over the network, so that adapter also
  means uploading before the transaction opens. The use cases that store a
  file (`addDeliverable`, `addExpense`, `recordAgreement`) would change in
  that one way.
- Every file still reaches R2, sealed, inside the nightly backup.
- A second volume or bucket would have needed its own backup and its own
  restore step. This choice avoids both until they are needed.

## Rejected

- **A folder on the Railway volume.** Not in the backup, so a restore would
  come back without its files.
- **R2 from the start.** A second thing to back up, and downloads would need
  the network for every file. Right when files get large, not before.
