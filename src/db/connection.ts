import Database from 'better-sqlite3';

export function createDb(path: string): Database.Database {
  return new Database(path);
}
