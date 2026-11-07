// The site's own records: each computer that connects, by an id of its own, with a hash of the key it connects with
// and, once its owner has an account, that account's name, which signing in on the site takes. No password is ever
// here: the computer checks its owner's itself (web/auth.ts), when the site passes the login on.
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

// A name the site can route by: letters and digits first, then those, dots, dashes, spaces.
export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,39}$/u;
const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");
const fresh = (bytes: number) => randomBytes(bytes).toString("hex");

export type Machine = { id: string; name: string | null };

export function openStore(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.run("CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, seen INTEGER)");
  // The records from before computers had ids, when each was linked by its name alone.
  if (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'computers'").get()) {
    for (const row of db.query("SELECT name, key, created, seen FROM computers").all() as { name: string; key: string; created: number; seen: number | null }[]) {
      db.run("INSERT OR IGNORE INTO machines (id, name, key, created, seen) VALUES (?, ?, ?, ?, ?)", [fresh(16), row.name, row.key, row.created, row.seen]);
    }
    db.run("DROP TABLE computers");
  }
  const one = <T>(sql: string, ...args: (string | number)[]) => db.query(sql).get(...args) as T | null;
  // A new computer, with the name given or none yet: its id, and the key it connects with from then on.
  const add = (name: string | null) => {
    const id = fresh(16);
    const key = fresh(32);
    try {
      db.run("INSERT INTO machines (id, name, key, created) VALUES (?, ?, ?, ?)", [id, name, hashOf(key), Date.now()]);
      return { id, key };
    } catch {
      return null;
    }
  };
  return {
    // A computer linked from its settings, under its account's name, if the name is free.
    link: (name: string) => (NAME_RULE.test(name) ? add(name) : null),
    // A computer that pairs as soon as it is installed, before it has an account; it takes a name once it has one.
    pair: () => add(null)!,
    // Gives the computer with this key its account's name: "ok", or why not.
    name(key: string, name: string): "ok" | "unknown" | "remote_name" | "remote_name_taken" {
      if (!NAME_RULE.test(name)) return "remote_name";
      const machine = one<{ id: string }>("SELECT id FROM machines WHERE key = ?", hashOf(key));
      if (!machine) return "unknown";
      try {
        db.run("UPDATE machines SET name = ? WHERE id = ?", [name, machine.id]);
        return "ok";
      } catch {
        return "remote_name_taken";
      }
    },
    // The computer whose account has this name, whatever its case.
    named: (name: string) => one<Machine>("SELECT id, name FROM machines WHERE name = ?", name),
    byId: (id: string) => one<Machine>("SELECT id, name FROM machines WHERE id = ?", id),
    byKey: (key: string) => one<Machine>("SELECT id, name FROM machines WHERE key = ?", hashOf(key)),
    unlink(key: string) {
      const machine = one<Machine>("SELECT id, name FROM machines WHERE key = ?", hashOf(key));
      db.run("DELETE FROM machines WHERE key = ?", [hashOf(key)]);
      return machine;
    },
    seen: (id: string) => { db.run("UPDATE machines SET seen = ? WHERE id = ?", [Date.now(), id]); },
    close: () => db.close(),
  };
}
