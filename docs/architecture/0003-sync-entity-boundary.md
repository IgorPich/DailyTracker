# ADR 0003: Sync entity boundary and identity

## Status

Accepted for the GreekGod 3 sync-ready storage foundation.

## Decision

SQLite schema v2 is additive to the v1 `app_data` mirror. Synchronizable records use a stable `(entity_type, entity_id)` key, globally monotonic desktop revision, full entity JSON payload and a retained tombstone for deletion. Nested workout exercises and sets remain inside the Workout payload; their order and historical snapshots are not relationally normalized.

Identity is mapped without changing the current domain model:

- Workout: exact existing `Workout.id`; duplicate IDs fail bootstrap preflight.
- DailyEntry: exact `date` as sync identity, while its current `id` remains in the payload; duplicate dates fail preflight.
- TrainingTemplate: exact existing template `id`.
- ExerciseDefinition: exact existing definition `id`.
- Settings: singleton key `global`.
- Coach note: exact current range key.
- Gym: a sidecar UUID maps the legacy name/list position. Bootstrap creates the sidecar once; rename changes the mapped name while preserving the UUID. Workout snapshots keep `gymLocation` and do not gain a new `gymId` field.

Legacy projection is copy-only and creates no outbox operations. It must validate identities before writing and fail closed instead of collapsing duplicates. Production Legacy Store remains active until explicit migration and cutover gates pass.

## Ordering and conflicts

`sync_meta.global_revision` is incremented in the same transaction as every accepted mutation. `base_revision` must exactly match the current entity revision; zero means no prior row. A tombstone is still a prior row, so a stale create cannot resurrect it. Local timestamps are audit metadata only and never the sole conflict-ordering mechanism.

Every local mutation writes the entity/tombstone and its outbox operation atomically. Applied operation IDs retain a canonical request hash and result so a lost response can be replayed idempotently, while reuse of an operation ID for different content fails closed.

## Consequences

- Exercise identity, progress comparison, equipment sensitivity and gym-aware historical snapshots stay unchanged.
- Pull can read `sync_entities` by global revision, including tombstones.
- The desktop and Sync Service can use short independent WAL transactions without a process-wide writer redesign.
- The aggregate v1 row may remain as a compatibility mirror during guarded migration, but it cannot be the two-writer synchronization surface.
