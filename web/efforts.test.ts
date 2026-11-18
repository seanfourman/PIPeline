import { describe, expect, test } from "bun:test";
import { effortsFrom } from "./efforts";

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

describe("the level Claude thinks at when none is picked", () => {
  test("a model's own level over the general one, later settings over earlier ones", () => {
    const user = { effortLevel: "xhigh", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } };
    expect(effortsFrom([user], MODELS)).toEqual({ "": "xhigh", "claude-opus-5-5": "medium", "claude-sonnet-5-5": "xhigh" });
    // The project's general level over the user's; the user's level for the model still wins for it.
    expect(effortsFrom([user, { effortLevel: "low" }], MODELS)).toEqual({ "": "low", "claude-opus-5-5": "medium", "claude-sonnet-5-5": "low" });
  });

  test("the default model is the settings' own model, when they name one", () => {
    const s = { effortLevel: "high", model: "claude-opus-5-5", modelSettings: { "claude-opus-5-5": { effortLevel: "low" } } };
    expect(effortsFrom([s], MODELS)[""]).toBe("low");
  });

  test("CLAUDE_CODE_EFFORT_LEVEL, from the environment or the settings' env, over everything", () => {
    const s = { effortLevel: "low", modelSettings: { "claude-opus-5-5": { effortLevel: "low" } } };
    expect(effortsFrom([s, { env: { CLAUDE_CODE_EFFORT_LEVEL: "medium" } }], MODELS)["claude-opus-5-5"]).toBe("medium");
    expect(effortsFrom([s, { env: { CLAUDE_CODE_EFFORT_LEVEL: "medium" } }], MODELS, "xhigh")).toEqual({ "": "xhigh", "claude-opus-5-5": "xhigh", "claude-sonnet-5-5": "xhigh" });
  });

  test("none set, or one the picker lacks, leaves a model out", () => {
    expect(effortsFrom([{}, {}], MODELS)).toEqual({});
    expect(effortsFrom([{ effortLevel: "max" }], MODELS)).toEqual({});
  });
});
