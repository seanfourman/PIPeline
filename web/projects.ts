// Projects: named groups of conversations, like a chat app's (2026-11-10). Kept in one file in the account's folder
// (user/app/projects.json, which the accounts' sync carries like the conversations): each with its id, its name and
// when it was made. A conversation names the project it is in (agent.ts); a project deleted takes none of its
// conversations with it, they only leave it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanName } from "./threads";

export type Project = { id: string; name: string; createdAt: number };
const valid = (p: any): p is Project => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.createdAt === "number";

export function createProjects(file: string) {
  const list = (): Project[] => {
    try { const d = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(d) ? d.filter(valid) : []; } catch { return []; }
  };
  const write = (projects: Project[]) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(projects, null, 2));
    renameSync(tmp, file);
  };
  return {
    list,
    create(name: unknown): Project | null {
      const clean = cleanName(name, 80);
      if (!clean) return null;
      const project = { id: crypto.randomUUID().slice(0, 8), name: clean, createdAt: Date.now() };
      write([...list(), project]);
      return project;
    },
    rename(id: string, name: unknown): Project | null {
      const clean = cleanName(name, 80);
      const projects = list();
      const project = projects.find((p) => p.id === id);
      if (!clean || !project) return null;
      project.name = clean;
      write(projects);
      return project;
    },
    remove(id: string) {
      const projects = list();
      if (!projects.some((p) => p.id === id)) return false;
      write(projects.filter((p) => p.id !== id));
      return true;
    },
  };
}
