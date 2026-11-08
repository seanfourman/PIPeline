// The site's own records: each computer that connects, by an id of its own, with a hash of the key it connects with
// and, once its owner has an account, that account's name, which signing in on the site takes. An account can be on
// several computers, and a computer can hold several accounts (members): the computer that made the account, and each
// that joined it after one of its computers checked the password (web/accounts.ts). No password is ever here: the
// computer checks its owner's itself (web/auth.ts), when the site passes the login on.
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
  db.run("CREATE TABLE IF NOT EXISTS members (account TEXT NOT NULL COLLATE NOCASE, machine TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (account, machine))");
  // Before an account could be on several computers, a computer's name was its one account.
  db.run("INSERT OR IGNORE INTO members (account, machine, added) SELECT name, id, created FROM machines WHERE name IS NOT NULL");
  const one = <T>(sql: string, ...args: (string | number)[]) => db.query(sql).get(...args) as T | null;
  const members = (account: string) => (db.query("SELECT machine FROM members WHERE account = ?").all(account) as { machine: string }[]).map((r) => r.machine);
  const join = (account: string, machine: string) => { db.run("INSERT OR IGNORE INTO members (account, machine, added) VALUES (?, ?, ?)", [account, machine, Date.now()]); };
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
    link(name: string) {
      if (!NAME_RULE.test(name) || members(name).length) return null;
      const made = add(name);
      if (made) join(name, made.id);
      return made;
    },
    // A computer that pairs as soon as it is installed, before it has an account; it takes a name once it has one.
    pair: () => add(null)!,
    // Puts the computer with this key on its account, by the account's name: "ok", or why not. A name another
    // computer's account has is taken, unless this computer joined that account.
    name(key: string, name: string): "ok" | "unknown" | "remote_name" | "remote_name_taken" {
      if (!NAME_RULE.test(name)) return "remote_name";
      const machine = one<{ id: string }>("SELECT id FROM machines WHERE key = ?", hashOf(key));
      if (!machine) return "unknown";
      const others = members(name).filter((id) => id !== machine.id);
      if (others.length && !members(name).includes(machine.id)) return "remote_name_taken";
      // The computer's own name is the account it made, which signing in found it by before there were members.
      try { db.run("UPDATE machines SET name = ? WHERE id = ?", [name, machine.id]); } catch { /* a joined account's */ }
      join(name, machine.id);
      return "ok";
    },
    // An account's name as it was made, whatever the case it is typed in, or null when no computer has it.
    account: (name: string) => one<{ account: string }>("SELECT account FROM members WHERE account = ? ORDER BY added LIMIT 1", name)?.account ?? null,
    // The computers an account is on, and whether one is.
    members,
    isMember: (account: string, machine: string) => members(account).includes(machine),
    join,
    // The computer whose account has this name, whatever its case.
    named: (name: string) => one<Machine>("SELECT id, name FROM machines WHERE name = ?", name),
    byId: (id: string) => one<Machine>("SELECT id, name FROM machines WHERE id = ?", id),
    byKey: (key: string) => one<Machine>("SELECT id, name FROM machines WHERE key = ?", hashOf(key)),
    unlink(key: string) {
      const machine = one<Machine>("SELECT id, name FROM machines WHERE key = ?", hashOf(key));
      db.run("DELETE FROM machines WHERE key = ?", [hashOf(key)]);
      if (machine) db.run("DELETE FROM members WHERE machine = ?", [machine.id]);
      return machine;
    },
    seen: (id: string) => { db.run("UPDATE machines SET seen = ? WHERE id = ?", [Date.now(), id]); },
    close: () => db.close(),
  };
}
