export type SqliteStoreErrorKind =
  | 'database-unavailable'
  | 'migration-failed'
  | 'invalid-or-corrupt-data'
  | 'constraint-violation'
  | 'write-failed'

export class SqliteStoreError extends Error {
  readonly kind: SqliteStoreErrorKind
  readonly causeValue?: unknown
  readonly migrationVersion?: number

  constructor(
    kind: SqliteStoreErrorKind,
    message: string,
    options: { cause?: unknown; migrationVersion?: number } = {},
  ) {
    super(message)
    this.name = 'SqliteStoreError'
    this.kind = kind
    this.causeValue = options.cause
    this.migrationVersion = options.migrationVersion
  }
}

const sqlitePrimaryErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as { errcode?: unknown }).errcode
  return typeof value === 'number' ? value & 0xff : undefined
}

export const mapSqliteError = (
  error: unknown,
  fallback: SqliteStoreErrorKind,
  message: string,
): SqliteStoreError => {
  if (error instanceof SqliteStoreError) return error
  const primaryCode = sqlitePrimaryErrorCode(error)
  const kind: SqliteStoreErrorKind = primaryCode === 14
    ? 'database-unavailable'
    : primaryCode === 11 || primaryCode === 26
      ? 'invalid-or-corrupt-data'
      : primaryCode === 19
        ? 'constraint-violation'
        : primaryCode === 8 || primaryCode === 10 || primaryCode === 13
          ? 'write-failed'
          : fallback
  return new SqliteStoreError(kind, message, { cause: error })
}
