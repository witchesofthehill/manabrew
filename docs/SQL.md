# SQL

All SQL is SQLite, all parameterized. Three databases, three owners:

| Database | Written by | Read by | Schema in |
|---|---|---|---|
| hub db | `manabrew-hub` | `manabrew-hub` | `crates/manabrew-hub/src/storage.rs` |
| `events.db` | `scripts/ingest-events.py` | `manabrew-hub` (`stats.rs`) | `scripts/ingest-events.py` |
| parity db | `parity` | `parity`, `parity-debugger` | `crates/parity/src/infra/storage.rs` |

Rules:

- Queries stay inline in Rust, parameterized, behind a storage struct. No SQL in route or auth code.
- Schema changes go through versioned `.sql` migration files (`rusqlite_migration`), not ad-hoc `ALTER TABLE` at startup.
- The `events.db` schema lives in one `.sql` file shared by the ingest script and the hub stats tests. Rust code reading a database it does not own must test against that schema file.
- No ORM. Revisit if we leave SQLite or hand-written mappers become a real tax. If the want is checked queries, sqlx comes before any ORM.
