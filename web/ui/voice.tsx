// Voice typing in the chat's box: a round button in the AI's colours by the box's other buttons. A tap and it
// listens, and what is said is written into the box as it is heard, after whatever is already there, to read over,
// fix and send like anything typed. While it listens, a glow in the AI's colours behind the box swells gently with the
// voice, a faint grain in it (VoiceGlow); the button's microphone turns into round-ended bars that move with the
// voice, and the language it listens in (עב or EN) shows beside it, a tap switching it. A second tap on the button
// stops it, and so do sending, any other change to the box, and half a minute with nothing said. The listening is the
// browser's own speech recognition, which Chrome and Edge have and Brave and Firefox don't: there, and for anything
// else that stops it, Pip says why from his peek (say), as he says everything else.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./app";
import type { Mood } from "./pip";
import { AiSky, Icon } from "./kit";
import { LISTEN_LANG, withSaid, type SpokenLang } from "./voice-text";

// The browser ends its listening every so often; it starts again this long after.
const RESTART_MS = 250;
// Nothing said for this long, and it stops.
const QUIET_MS = 30_000;
const LANG_KEY = "pip-voice-lang";
// How the voice's loudness is eased, in seconds to follow most of a change: for the bars, quickly up and a little
// slower down; for the glow, from the bars' level again, up within a moment and down more slowly, so it follows the
// voice without jumping.
const QUICK_UP = 0.06;
const QUICK_DOWN = 0.18;
const SLOW_UP = 0.15;
const SLOW_DOWN = 0.5;
// Each bar's height at the voice's loudness, the two middle ones tallest and the row even about its middle, so it
// sits centred; and how long each takes to follow, so they move a little apart.
const BARS = [{ k: 0.62, tau: 0.07 }, { k: 1, tau: 0.1 }, { k: 0.96, tau: 0.13 }, { k: 0.6, tau: 0.09 }];
// Toward target from now, over dt seconds, taking tau seconds to follow most of the way.
const ease = (now: number, target: number, dt: number, tau: number) => now + (target - now) * (1 - Math.exp(-dt / tau));

const recognition = () => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
// Brave has the recognition's name but not the service behind it.
const isBrave = () => Boolean((navigator as any).brave);
// A phone's recognition wants the microphone to itself, and its keyboard would cover the box: there the glow follows
// the words as they come in, and the box isn't focused.
const finePointer = () => !matchMedia("(pointer: coarse)").matches;
const stillMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Pip's face for each thing he says about voice typing.
const NOTE_MOODS: Record<string, Mood> = {
  "voice.unsupported": "confused", "voice.micDenied": "worried", "voice.noMic": "confused",
  "voice.network": "worried", "voice.langUnsupported": "confused", "voice.failed": "confused",
};

export type VoiceTyping = {
  on: boolean; lang: SpokenLang;
  // How loud the voice is now, from 0 to 1, eased slowly (for the glow).
  level: () => number;
  toggle: () => void; stop: () => void; setLang: (l: SpokenLang) => void;
  // The button, whose bars (--b0 to --b3) the voice moves.
  button: React.RefObject<HTMLButtonElement>;
};

// Voice typing for a box: its words (text, setText) and the box itself, which it focuses to send from with Enter.
export function useVoiceTyping(text: string, setText: (v: string) => void, box: React.RefObject<HTMLTextAreaElement>): VoiceTyping {
  const { t, lang: uiLang, say } = useApp();
  const [on, setOn] = useState(false);
  const [lang, setLangState] = useState<SpokenLang>(() => {
    try { const kept = localStorage.getItem(LANG_KEY); if (kept === "he" || kept === "en") return kept; } catch { /* private window */ }
    return uiLang === "en" ? "en" : "he";
  });
  const button = useRef<HTMLButtonElement>(null);
  // What the browser's callbacks need at the time they come. The box's words as listening began (before), what
  // earlier rounds of listening heard (kept), what this round has heard so far (heard), what was last written into
  // the box (wrote), and whether anything else has changed the box since (touched), after which nothing more is
  // written into it.
  const s = useRef({
    t, say, text, setText, on: false, lang,
    before: "", kept: "", heard: "", wrote: "", touched: true,
    rec: null as any, round: 0, restart: undefined as ReturnType<typeof setTimeout> | undefined, quiet: undefined as ReturnType<typeof setTimeout> | undefined,
    stream: null as MediaStream | null, audio: null as AudioContext | null, frame: 0, pulse: 0, quick: 0, level: 0, bars: BARS.map(() => 0), snap: 0,
  }).current;
  s.t = t;
  s.say = say;
  s.text = text;
  s.setText = setText;

  const ctl = useMemo(() => {
    const write = () => {
      if (s.touched) return;
      s.wrote = withSaid(s.before, withSaid(s.kept, s.heard));
      s.setText(s.wrote);
    };
    const hush = () => {
      clearTimeout(s.quiet);
      s.quiet = setTimeout(() => stop(), QUIET_MS);
    };

    // One round of the browser's listening. What it hears is written in as it comes; when the browser ends the round,
    // another begins if still on. After a stop, the round's last words still come in, unless the box has changed.
    const listen = () => {
      clearTimeout(s.restart);
      if (!s.on) return;
      const Rec = recognition();
      const rec = (s.rec = new Rec());
      const round = ++s.round;
      s.heard = "";
      rec.lang = LISTEN_LANG[s.lang];
      // On a phone a round is one stretch of talk: Android's recognition, left running, repeats what it heard.
      rec.continuous = finePointer();
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (ev: any) => {
        if (round !== s.round) return;
        let heard = "";
        for (let i = 0; i < ev.results.length; i++) heard = withSaid(heard, ev.results[i][0].transcript);
        s.heard = heard;
        s.pulse = 1;
        write();
        if (s.on) hush();
      };
      rec.onerror = (ev: any) => {
        if (round !== s.round) return;
        const code = String(ev?.error ?? "");
        if (code === "no-speech" || code === "aborted") return;
        const key = code === "not-allowed" || code === "service-not-allowed" ? "voice.micDenied" : code === "audio-capture" ? "voice.noMic"
          : code === "network" ? "voice.network" : code === "language-not-supported" ? "voice.langUnsupported" : "voice.failed";
        fail(key, code);
      };
      rec.onend = () => {
        if (round !== s.round) return;
        s.kept = withSaid(s.kept, s.heard);
        s.heard = "";
        s.rec = null;
        if (s.on) s.restart = setTimeout(listen, RESTART_MS);
      };
      try { rec.start(); } catch { fail("voice.failed", "start"); }
    };
    // The round listening now ends. settle: the browser may still bring its last words; otherwise they are dropped
    // and what it heard so far is kept.
    const halt = (settle: boolean) => {
      clearTimeout(s.restart);
      const rec = s.rec;
      if (!rec) return;
      if (settle) {
        try { rec.stop(); } catch { /* not running */ }
        return;
      }
      s.round++;
      s.kept = withSaid(s.kept, s.heard);
      s.heard = "";
      s.rec = null;
      try { rec.abort(); } catch { /* not running */ }
    };

    // How loud the voice is, frame by frame and by the time passed, eased twice: for the bars (quick), each bar
    // following it at its own pace, and again for the glow (level), gradually, so it never jumps. The microphone's
    // loudness on a computer, a beat on each word heard on a phone.
    const meter = (analyser: AnalyserNode | null) => {
      const data = analyser ? new Uint8Array(analyser.fftSize) : null;
      let last = performance.now();
      const tick = (now: number) => {
        if (!s.on) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        let target = 0;
        if (analyser && data) {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) { const d = (v - 128) / 128; sum += d * d; }
          target = Math.min(1, Math.sqrt(sum / data.length) * 6);
        } else {
          s.pulse *= Math.exp(-dt / 0.25);
          target = s.pulse * 0.8;
        }
        s.quick = ease(s.quick, target, dt, target > s.quick ? QUICK_UP : QUICK_DOWN);
        s.level = ease(s.level, s.quick, dt, s.quick > s.level ? SLOW_UP : SLOW_DOWN);
        BARS.forEach((bar, i) => {
          s.bars[i] = ease(s.bars[i], Math.min(1, s.quick * bar.k), dt, bar.tau);
          button.current?.style.setProperty(`--b${i}`, s.bars[i].toFixed(3));
        });
        pixelBars();
        s.frame = requestAnimationFrame(tick);
      };
      s.frame = requestAnimationFrame(tick);
    };
    const release = () => {
      cancelAnimationFrame(s.frame);
      s.stream?.getTracks().forEach((track) => track.stop());
      s.stream = null;
      s.audio?.close().catch(() => {});
      s.audio = null;
      s.quick = s.level = 0;
      s.bars = BARS.map(() => 0);
      s.snap = 0;
      for (const name of [...BARS.map((_, i) => `--b${i}`), "--bar-w", "--bar-gap"]) button.current?.style.removeProperty(name);
    };
    // The bars drawn alike and centred: their width and the space between them whole pixels of the screen (at its
    // scale), so no bar is drawn sharper or blurrier than the others, and the row placed on whole pixels as near as
    // can be to the button's middle. 3 pixels wide, 4 apart.
    const pixelBars = () => {
      const el = button.current;
      const row = el?.querySelector<HTMLElement>(".voice-bars");
      if (!el || !row) return;
      const dpr = devicePixelRatio || 1;
      const bar = Math.round(3 * dpr);
      const gap = Math.round(4 * dpr);
      el.style.setProperty("--bar-w", `${bar / dpr}px`);
      el.style.setProperty("--bar-gap", `${gap / dpr}px`);
      const middle = el.getBoundingClientRect();
      const want = Math.round((middle.left + middle.width / 2) * dpr - (BARS.length * bar + (BARS.length - 1) * gap) / 2);
      const at = (row.getBoundingClientRect().left - s.snap) * dpr;
      const snap = (want - at) / dpr;
      if (Math.abs(snap - s.snap) > 0.001) {
        s.snap = snap;
        row.style.translate = `${snap.toFixed(3)}px 0`;
      }
    };

    // Off, the microphone let go; settle as in halt.
    const end = (settle: boolean) => {
      clearTimeout(s.quiet);
      s.on = false;
      setOn(false);
      halt(settle);
      release();
    };
    // Why it stopped, said by Pip from his peek with the face it calls for.
    const fail = (key: string, detail = "") => {
      end(false);
      s.say(s.t(key, { detail }), NOTE_MOODS[key] ?? "confused");
    };
    const stop = () => end(true);
    // On a computer the box gets the focus, so Enter sends and the keys type.
    const focus = () => { if (finePointer()) box.current?.focus(); };

    const start = async () => {
      if (!recognition() || isBrave()) return s.say(s.t("voice.unsupported"), NOTE_MOODS["voice.unsupported"]);
      // A round still bringing its last words ends here: the box already shows them.
      halt(false);
      s.on = true;
      setOn(true);
      s.before = s.wrote = s.text;
      s.kept = s.heard = "";
      s.touched = false;
      focus();
      hush();
      let analyser: AnalyserNode | null = null;
      if (finePointer()) {
        try {
          s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (err: any) {
          return fail(err?.name === "NotFoundError" ? "voice.noMic" : "voice.micDenied", String(err?.name ?? ""));
        }
        // Stopped while the browser asked for the microphone.
        if (!s.on) return release();
        try {
          const audio = (s.audio = new AudioContext());
          analyser = audio.createAnalyser();
          analyser.fftSize = 512;
          audio.createMediaStreamSource(s.stream).connect(analyser);
        } catch { analyser = null; }
      }
      if (!stillMotion()) meter(analyser);
      listen();
    };

    return {
      end, stop,
      level: () => s.level,
      toggle: () => {
        if (s.on) { stop(); focus(); } else start();
      },
      setLang: (next: SpokenLang) => {
        s.lang = next;
        setLangState(next);
        try { localStorage.setItem(LANG_KEY, next); } catch { /* private window */ }
        if (s.on) {
          halt(false);
          s.restart = setTimeout(listen, RESTART_MS);
        }
      },
    };
  }, []);

  // The box changed by anything but what was heard (typed in, sent, a start picked): it is left as it is, and
  // listening stops. Before the page paints, so no word heard meanwhile is written over the change.
  useLayoutEffect(() => {
    if (text === s.wrote) return;
    s.touched = true;
    if (s.on) ctl.end(false);
  }, [text]);
  useEffect(() => () => ctl.end(false), []);

  return useMemo<VoiceTyping>(() => ({
    on, lang, level: ctl.level, toggle: ctl.toggle, stop: ctl.stop, setLang: ctl.setLang, button,
  }), [ctl, on, lang]);
}

// The round button by the box: the AI's colours with a white microphone, which turns into four round-ended bars that
// move with the voice while it listens; before it then, the language it listens in. Each says what it does in the
// page's own floating label (.act-label).
export function VoiceTypingButton({ v }: { v: VoiceTyping }) {
  const { t } = useApp();
  const other: SpokenLang = v.lang === "he" ? "en" : "he";
  const langLabel = t("voice.lang", { lang: t(`voice.langNames.${v.lang}`) });
  const label = t(v.on ? "voice.stop" : "voice.start");
  return (
    <>
      {v.on && (
        <button type="button" className="voice-lang" aria-label={langLabel} onClick={() => v.setLang(other)}>
          {t(`voice.langs.${v.lang}`)}<span className="act-label" aria-hidden="true">{langLabel}</span>
        </button>
      )}
      <button ref={v.button} type="button" className={`voice-go ${v.on ? "on" : ""}`} aria-pressed={v.on} aria-label={label} onClick={v.toggle}>
        <AiSky orb />
        {v.on ? <span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /></span> : <Icon name="mic" />}
        <span className="act-label" aria-hidden="true">{label}</span>
      </button>
    </>
  );
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x6cbcf0;
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${Math.max(0, a).toFixed(3)})`;
// The AI's colours round the glow's middle, in the order the apply button's rim has them (.apply-rim), from the page's
// own (--sky-*), so day and night each have theirs. Each way out from the middle keeps its own colour, so they never
// muddy into grey where they meet.
const GLOW_COLOURS = ["--sky-3", "--sky-6", "--sky-5", "--sky-4", "--sky-1", "--sky-2"];

// A tile of fine grain, as the noise in Claude's glow: half its pixels clear, the rest a faint white or, now and
// then, a faint dark, seen when looked for but never in the way. Made once, and still.
const GRAIN = 160;
let grain: HTMLCanvasElement | null = null;
function grainTile() {
  if (grain) return grain;
  const tile = document.createElement("canvas");
  tile.width = tile.height = GRAIN;
  const g = tile.getContext("2d");
  if (g) {
    const img = g.createImageData(GRAIN, GRAIN);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      if (v < 0.5) continue;
      const light = Math.random() < 0.75;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 20;
      img.data[i + 3] = Math.round(((v - 0.5) / 0.5) * (light ? 74 : 32));
    }
    g.putImageData(img, 0, 0);
  }
  return (grain = tile);
}

// Behind the box while it listens, as in Claude's voice mode: a soft glow in the AI's colours, turning slowly, with a
// faint grain over it, growing and brightening with the voice (the eased level): small and soft while nothing
// is said, reaching far only when the voice is loud. In a new conversation, whose box sits in the middle of the page,
// it is a halo round the box; in a conversation, whose box is at the foot, it rises straight up from the box, no wider
// than the box and never beside or under it. It fades in as listening starts and out as it stops (about a third of a
// second, never in the way), follows the box as it grows, and draws nothing in between. A canvas over the
// conversation's whole area, under everything in it (.voice-glow).
export function VoiceGlow({ v, shape, box }: { v: VoiceTyping; shape: "halo" | "rise"; box: React.RefObject<HTMLElement> }) {
  const { dark } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const g = useRef({ on: v.on, dark, running: false, frame: 0 }).current;
  g.on = v.on;
  g.dark = dark;
  const level = v.level;
  useEffect(() => {
    if (!v.on || g.running) return;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    g.running = true;
    const still = stillMotion();
    const style = getComputedStyle(document.documentElement);
    const colours = GLOW_COLOURS.map((name) => rgb(style.getPropertyValue(name)));
    const noise = ctx.createPattern(grainTile(), "repeat");
    let fade = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fade = ease(fade, g.on ? 1 : 0, dt, 0.12);
      const el = box.current;
      if ((!g.on && fade < 0.01) || !el) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        g.running = false;
        return;
      }
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      // Where the box is now, within the canvas, and the glow round it, as far as the voice carries it: the halo's
      // middle a little over the box's, reaching 48 to 228 pixels past its sides and 72 to 276 over and under it; the
      // rising glow's just under the box's top edge, as wide as the box, 84 pixels high while nothing is said and up
      // to 480 when the voice is loud. The rise grows faster than the voice (lift), so talking keeps it low and only a
      // loud voice takes it far.
      const cr = c.getBoundingClientRect();
      const br = el.getBoundingClientRect();
      const halo = shape === "halo";
      const top = br.top - cr.top;
      const lv = still ? 0.4 : level();
      const time = still ? 0 : now / 1000;
      const cx = br.left - cr.left + br.width / 2;
      const cy = halo ? top + br.height / 2 - 16 : top + br.height * 0.3;
      const rx = halo ? br.width / 2 + 48 + 180 * lv : br.width * 0.48;
      const lift = lv * lv;
      const ry = halo ? br.height / 2 + 72 + 204 * lv : Math.min(84 + 396 * lift, h * 0.75);
      // The colours turning round the middle, then faded from the middle out (destination-in keeps them only as much
      // as the fade is there); it breathes a little.
      const grow = 1 + 0.02 * Math.sin(time * 0.7);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx * grow, ry * grow);
      const cone = ctx.createConicGradient(time * 0.25, 0, 0);
      colours.forEach((col, k) => cone.addColorStop(k / colours.length, rgba(col, 1)));
      cone.addColorStop(1, rgba(colours[0], 1));
      ctx.fillStyle = cone;
      ctx.fillRect(-1, -1, 2, 2);
      const peak = fade * (0.35 + 0.65 * lv) * (g.dark ? 0.75 : 0.66);
      const fall = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      fall.addColorStop(0, `rgba(0,0,0,${peak.toFixed(3)})`);
      fall.addColorStop(0.35, `rgba(0,0,0,${(peak * 0.72).toFixed(3)})`);
      fall.addColorStop(0.7, `rgba(0,0,0,${(peak * 0.26).toFixed(3)})`);
      fall.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = fall;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      // The grain, only where the glow is (source-atop), a grain to a pixel, still.
      if (noise) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = noise;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.restore();
      }
      // Rising from the box: nothing beside or under it, fading out from a little under its top edge to its foot.
      if (!halo) {
        const cut = ctx.createLinearGradient(0, top + br.height * 0.2, 0, br.bottom - cr.top);
        cut.addColorStop(0, "rgba(0,0,0,1)");
        cut.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = cut;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
      g.frame = requestAnimationFrame(draw);
    };
    g.frame = requestAnimationFrame(draw);
  }, [v.on]);
  useEffect(() => () => { cancelAnimationFrame(g.frame); g.running = false; }, []);
  return <canvas ref={canvas} className="voice-glow" aria-hidden="true" />;
}
