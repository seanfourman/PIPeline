// ChatGPT through its own command-line tool, signed in with the user's account, the way Claude runs through Claude
// Code: Codex on the ChatGPT plan, so no API key and no pay per use. It is installed in the project at a fixed
// version (package.json) and keeps its login in its own folder in the user's home (~/.codex). A plain answer is one
// run with no project at all: an empty folder of its own, read-only, nothing kept; what was attached is copied in.
// A conversation's agent runs through codex.ts instead. The key stays an alternative (chatbots.ts).
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatbotError, type Turn } from "./chatbots";

export type Cli = "openai";
const EXE = path.join(import.meta.dir, "node_modules", ".bin", process.platform === "win32" ? "codex.exe" : "codex");
const ANSWER_MS = 4 * 60 * 1000;
// Whether it is signed in, asked again at most this often: the state is read every few seconds.
const STATUS_MS = 15_000;

let checked = 0;
let signedIn: Record<Cli, boolean> = { openai: false };

async function run(argv: string[], options: { cwd?: string; stdin?: string; signal?: AbortSignal; ms?: number } = {}) {
  const proc = Bun.spawn(argv, { cwd: options.cwd, stdin: options.stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  if (options.stdin !== undefined) { const sink = proc.stdin as unknown as { write: (s: string) => void; end: () => void }; sink.write(options.stdin); sink.end(); }
  const kill = () => proc.kill();
  options.signal?.addEventListener("abort", kill);
  const timer = setTimeout(kill, options.ms ?? ANSWER_MS);
  const [out, err] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", kill);
  return { code, out, err };
}

// The last that was found, for what can't wait for a check (ai.ts).
export const cliSignedIn = () => signedIn;

// Codex says so itself.
export async function cliStatus(): Promise<Record<Cli, boolean>> {
  if (Date.now() - checked < STATUS_MS) return signedIn;
  checked = Date.now();
  const codex = existsSync(EXE) ? await run([EXE, "login", "status"], { ms: 20_000 }).catch(() => null) : null;
  signedIn = { openai: Boolean(codex && codex.code === 0 && /logged in/i.test(codex.out + codex.err)) };
  return signedIn;
}

// Signing in opens Codex in a window of its own on this computer, where the user finishes it in the browser; the
// settings see it within a few seconds after.
export function openLogin(_cli: Cli) {
  if (!existsSync(EXE)) throw new ChatbotError("ai_cli_missing");
  checked = 0;
  if (process.platform === "win32") Bun.spawn(["cmd", "/c", "start", "Codex", EXE, "login"], { stdout: "ignore", stderr: "ignore" });
  else Bun.spawn([EXE, "login"], { stdout: "ignore", stderr: "ignore" });
}

// The whole of what is asked, as one text: the instructions, the conversation so far, and the new message. The
// files attached to it go into the run's own folder, the pictures given to Codex as pictures.
function prepare(system: string, turns: Turn[], dir: string) {
  const last = turns[turns.length - 1];
  const earlier = turns.slice(0, -1).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`).join("\n\n");
  const images: string[] = [];
  const notes: string[] = [];
  for (const u of last?.uploads ?? []) {
    if (u.kind === "text") { notes.push(`Attached file ${u.name}:\n${readFileSync(u.file, "utf8").slice(0, 200_000)}`); continue; }
    const name = `${images.length + notes.length + 1}-${path.basename(u.file).replace(/[^\w.-]+/g, "_")}`;
    copyFileSync(u.file, path.join(dir, name));
    if (u.kind === "image") images.push(path.join(dir, name));
    else notes.push(`Attached file ${u.name}: it is ${name} in your working folder.`);
  }
  const text = [
    "Follow these instructions. Answer only in your final message; there is nothing to change or run.",
    "<instructions>", system, "</instructions>",
    earlier && `The conversation so far:\n\n${earlier}\n\nThe user's new message:`,
    last?.text || "(see the attachment)",
    ...notes,
  ].filter(Boolean).join("\n\n");
  return { text, images };
}

const failure = (out: string) => {
  const line = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(" ").slice(0, 300);
  if (/usage limit|rate limit|quota|exhausted|429/i.test(out)) return new ChatbotError("ai_quota", line);
  if (/not logged in|login|auth|credential|401|403/i.test(out)) return new ChatbotError("ai_cli_login", line);
  return new ChatbotError("ai_failed", line || "Codex failed");
};

export async function askCli(_cli: Cli, system: string, turns: Turn[], signal: AbortSignal) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ai-job-search-openai-"));
  try {
    const { text, images } = prepare(system, turns, dir);
    const last = path.join(dir, ".answer.txt");
    const r = await run([EXE, "exec", "-", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-C", dir, "--color", "never", "-o", last, ...images.flatMap((i) => ["-i", i])], { cwd: dir, stdin: text, signal });
    if (signal.aborted) return "";
    const answer = existsSync(last) ? readFileSync(last, "utf8").trim() : "";
    if (r.code !== 0 || !answer) throw failure(r.err + "\n" + r.out);
    return answer;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
