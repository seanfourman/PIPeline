// The interface is React in ui/. The server bundles it on every start, so the page always matches its source.
import path from "node:path";

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
