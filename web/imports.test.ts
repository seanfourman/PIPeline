import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Bun runs a module that imports one name twice, the last import silently winning, and nothing here runs TypeScript,
// which would refuse it. server.ts once took chatbots.ts's saveKey and synckey.ts's under one name, so saving an AI key
// in the settings wrote it as a sync key. Every source file is checked here for a name imported twice.
const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  if (name === "node_modules" || name.startsWith(".")) return [];
  return statSync(full).isDirectory() ? sources(full) : /\.tsx?$/.test(name) ? [full] : [];
});

// The names an import brings in: its default, its namespace (* as x), and each of its braces, by its own name or the
// one after "as".
function importedNames(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/^import\s+(?:type\s+)?([^;]*?)\s+from\s+["'][^"']+["']/gm)) {
    const clause = m[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(",") : []) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
    for (const word of clause.replace(/\{[^}]*\}/, " ").replace(/\*\s+as\s+/, " ").replace(/,/g, " ").split(/\s+/)) {
      if (word) names.push(word);
    }
  }
  return names;
}

test("the names an import brings in are read as written", () => {
  expect(importedNames('import React, { useState, type FC, a as b } from "react";\nimport * as fs from "node:fs";\nimport type { X } from "./x";\nimport "./side";'))
    .toEqual(["useState", "FC", "b", "React", "fs", "X"]);
});

test("no source file imports one name twice", () => {
  const twice = sources(import.meta.dir).flatMap((file) => {
    const names = importedNames(readFileSync(file, "utf8"));
    return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].map((n) => `${path.relative(import.meta.dir, file)}: ${n}`);
  });
  expect(twice).toEqual([]);
});
