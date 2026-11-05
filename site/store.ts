// The site's own records: each linked computer by its account's name, and a hash of the key it connects with. No
// password is ever here: the computer checks its owner's itself (web/auth.ts), when the site passes the login on.
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

// A name the site can route by, and put in a cookie: letters and digits first, then those, dots, dashes, spaces.
export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,39}$/u;
const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");

export function openStore(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.run("CREATE TABLE IF NOT EXISTS computers (name TEXT PRIMARY KEY COLLATE NOCASE, key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, seen INTEGER)");
  const one = <T>(sql: string, ...args: (string | number)[]) => db.query(sql).get(...args) as T | null;
  return {
    // A computer takes a free name and gets the key it connects with from then on; a taken name gets nothing.
    link(name: string): string | null {
      if (!NAME_RULE.test(name)) return null;
      const key = randomBytes(32).toString("hex");
      try {
        db.run("INSERT INTO computers (name, key, created) VALUES (?, ?, ?)", [name, hashOf(key), Date.now()]);
        return key;
      } catch {
        return null;
      }
    },
    // The name as it was linked, whatever its case, or null.
    named: (name: string) => one<{ name: string }>("SELECT name FROM computers WHERE name = ?", name)?.name ?? null,
    byKey: (key: string) => one<{ name: string }>("SELECT name FROM computers WHERE key = ?", hashOf(key))?.name ?? null,
    unlink(key: string) {
      const name = one<{ name: string }>("SELECT name FROM computers WHERE key = ?", hashOf(key))?.name ?? null;
      db.run("DELETE FROM computers WHERE key = ?", [hashOf(key)]);
      return name;
    },
    seen: (name: string) => { db.run("UPDATE computers SET seen = ? WHERE name = ?", [Date.now(), name]); },
    close: () => db.close(),
  };
}
