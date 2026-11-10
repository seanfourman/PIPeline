// The interface is React in ui/. The server bundles it on every start, and again whenever its source changes, so
// the page always matches its source and the stylesheet (public/, served as it is): reloading the page is enough.
import { watch } from "node:fs";
import path from "node:path";

const SOURCES = [path.join(import.meta.dir, "ui"), path.join(import.meta.dir, "roles.ts")];
const SETTLE_MS = 300;

export function watchInterface(outdir: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A rebuild that works prints nothing, so a failed one's errors stay in the window after they're fixed. The first
  // good rebuild after a failure says so, and the old errors aren't taken for a page that is still broken.
  let failed = false;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildInterface(outdir).then(
      () => { if (failed) console.log("The interface rebuilt: the errors above are fixed."); failed = false; },
      (err) => { failed = true; console.error("The interface did not rebuild:", err); },
    ), SETTLE_MS);
  };
  for (const source of SOURCES) watch(source, { recursive: true }, rebuild);
}

export async function buildInterface(outdir: string) {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "ui", "main.tsx")],
    outdir,
    target: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "The interface did not build");
  return result.outputs.map((o) => o.path);
}
