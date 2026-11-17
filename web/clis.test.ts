import { describe, expect, test } from "bun:test";
import { windowsLoginLine } from "./clis";

describe("signing in", () => {
  test("on Windows, the window's title goes first in quotes, so start runs the sign-in and not a program named for it", () => {
    const exe = String.raw`C:\Users\Some One\web\node_modules\claude.exe`;
    const line = windowsLoginLine("Claude", exe, ["auth", "login"]);
    expect(line).toBe(String.raw`start "Claude" /wait "C:\Users\Some One\web\node_modules\claude.exe" auth login`);
  });

  // What start does with that line, run with harmless programs and no window at all (/B): an unquoted first word is
  // the program to run, which is how the sign-in never ran (2026-11-17), and a quoted one is the title.
  test.if(process.platform === "win32")("start takes an unquoted first word for the program, and a quoted one for the title", async () => {
    const said = async (line: string) => {
      const p = Bun.spawn(["cmd", "/c", line], { stdout: "pipe", stderr: "pipe", windowsVerbatimArguments: true });
      return (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    };
    expect(await said("start /B hostname whoami")).toMatch(/hostname/i);
    expect(await said('start "hostname" /B whoami')).not.toMatch(/hostname/i);
  });
});
