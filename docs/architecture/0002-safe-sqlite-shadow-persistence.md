# ADR 0002: Safe SQLite shadow persistence

## Status

Accepted for GreekGod 3 Phase 2. The production desktop runtime remains on the legacy Tauri Store.

## Context

GreekGod 2.6.1 persists one `AppData` aggregate as JSON. Array order is meaningful for workouts, exercises, sets and template exercises, while historical workouts contain snapshots that must not follow later template or exercise changes. Phase 2 needs a testable SQLite alternative without changing this data contract or reading/migrating the user's live Store.

## Decision

- `AppDataStore` remains an aggregate-level port with `load`, `save` and `backupBeforeImport`.
- The production composition root selects `LegacyAppDataStore`; SQLite is not imported by application source.
- The Phase 2 SQLite adapter uses Node's built-in SQLite only in development/tests. Every database must be named `greekgod-v3.sqlite`, live under an explicitly allowed isolated root and is rejected inside the production `com.igorpich.formlog` directory.
- Schema version 1 uses two strict tables:
  - `schema_migrations(version, name, checksum, applied_at)`;
  - `app_data(singleton_id = 1, data_version, payload_json)`.
- `data_version` is the current `AppData.version` and is independent from the SQLite schema migration version.
- One full aggregate is written with `BEGIN IMMEDIATE` and one UPSERT. Reads pass through the same `normalizeData` contract as legacy storage.
- Schema migrations are ordered, checksummed and transactional. A changed checksum or failed migration is a typed `migration-failed` error.
- SQLite backups use the SQLite online backup API and verification; the active database file is never copied directly.

## Ordering and snapshots

The first schema deliberately stores the current aggregate as JSON rather than normalizing it into entity tables. JSON arrays preserve every existing position without relying on unspecified SQL row order. The same representation preserves historical exercise names, IDs, sets, notes, gym, workout type and other optional snapshot fields exactly as the current model defines them.

## Consequences

- Persistence migration is separated from future sync metadata such as revisions, tombstones, device IDs and outbox records.
- Phase 2 proves contract, migration and differential equivalence without altering the UI, Tauri capabilities, production identifier or production Store.
- A later runtime SQLite phase will require an explicitly approved native Tauri/mobile driver and concurrency/WAL tests. The Node development adapter is not the future WebView or Android driver.
- Relational normalization, if ever needed for sync, must be a separately versioned and tested schema decision rather than an incidental part of this migration.
