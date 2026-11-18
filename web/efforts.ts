// How hard Claude thinks, picked beside the model (chat.tsx EffortSlider); none is the user's own default.
export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (e: unknown): e is Effort => EFFORTS.includes(e as Effort);

// The level Claude thinks at in a conversation where none is picked, for the default model ("") and each of models,
// as Claude Code reads it from its settings: sources in the order it reads them, each over the one before (the user's,
// the project's, the local ones), a model's own level (modelSettings) over the general one, the default model being
// the settings' model when they name one; and CLAUDE_CODE_EFFORT_LEVEL, from the environment (forced) or the
// settings' env, over all of it. A model is missing where none is set, or where it is one the picker lacks; the
// model's own default holds there, which nothing here can read.
export function effortsFrom(sources: Record<string, any>[], models: readonly string[], forced?: string): Record<string, Effort> {
  let level: unknown;
  let model = "";
  let env: unknown;
  const own: Record<string, unknown> = {};
  for (const s of sources) {
    if (s.effortLevel !== undefined) level = s.effortLevel;
    if (typeof s.model === "string") model = s.model;
    if (s.env?.CLAUDE_CODE_EFFORT_LEVEL) env = s.env.CLAUDE_CODE_EFFORT_LEVEL;
    for (const [m, v] of Object.entries(s.modelSettings ?? {})) if ((v as any)?.effortLevel !== undefined) own[m] = (v as any).effortLevel;
  }
  const over = forced || env;
  const out: Record<string, Effort> = {};
  for (const m of ["", ...models]) {
    const id = m || model;
    const e = over ?? (id && own[id] !== undefined ? own[id] : level);
    if (isEffort(e)) out[m] = e;
  }
  return out;
}
