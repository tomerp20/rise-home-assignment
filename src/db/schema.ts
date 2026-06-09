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
  // Migrate existing databases that pre-date the version column
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists — safe to ignore
  }
}
