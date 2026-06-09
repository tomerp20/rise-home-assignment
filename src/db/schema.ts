import Database from 'better-sqlite3';

export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      publisherId TEXT NOT NULL,
      status      TEXT NOT NULL CHECK(status IN ('active', 'paused', 'ended')),
      startDate   TEXT NOT NULL,
      createdAt   TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Index-back the list query + COUNT(*) (which filter/sort by publisherId, createdAt)
  // so they don't full-table scan. Mirrors the DynamoDB GSI-on-publisherId design,
  // keeping the two storage implementations consistent.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_campaigns_publisher ON campaigns(publisherId, createdAt)',
  );
}
