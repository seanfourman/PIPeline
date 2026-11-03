// Chooses the website's roles from the ready-made list (roles.ts), for /setup to run once it knows the candidate:
//   bun run web/pick-roles.ts --list                  the list, by field, each role's id and title
//   bun run web/pick-roles.ts [--level junior] id ...  these roles, in this order, and the experience level
// The roles chosen replace those chosen from the list before; any typed in by hand on the settings screen stay,
// after them. Saving goes the same way as the settings screen's, so the search settings in CLAUDE.md and
// search-queries.md follow.
import { REPO } from "./policy";
import { listedRole, ROLE_FIELDS, type Level } from "./roles";
import { loadSettings, pickRoles, saveSettings } from "./settings";

const LEVELS: Level[] = ["any", "junior", "middle", "senior"];
const args = process.argv.slice(2);

if (!args.length || args[0] === "--list") {
  for (const field of ROLE_FIELDS) {
    console.log(`${field.en}:`);
    for (const r of field.roles) console.log(`  ${r.id.padEnd(12)} ${r.title}${r.fixed ? " (a level of its own)" : ""}`);
  }
  process.exit(0);
}

const at = args.indexOf("--level");
const level = at === -1 ? undefined : args[at + 1];
if (at !== -1 && !LEVELS.includes(level as Level)) {
  console.error(`--level must be one of: ${LEVELS.join(", ")}`);
  process.exit(1);
}
const ids = args.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
const unknown = ids.filter((id) => !listedRole(id));
if (unknown.length || !ids.length) {
  console.error(unknown.length ? `Not on the list: ${unknown.join(", ")}. See --list.` : "Name at least one role from --list.");
  process.exit(1);
}

const saved = saveSettings(pickRoles(loadSettings(), ids, level as Level | undefined), REPO);
console.log(`Experience level: ${saved.seniority}`);
console.log(`Roles: ${saved.roles.map((r) => `${r.label} (${r.query})`).join(", ")}`);
