// The site's own pages, for a phone that has not reached its computer yet: the sign-in, and the note that the
// computer is off. Once signed in, everything is the computer's own interface, passed along (relay.ts). The look is
// the app's board: parchment in a wooden frame over the forest's sky and grass, in square pixel edges.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Pip's mark, the same pixels as the app's (MARK in web/ui/pip.tsx), in Pip's orange.
const MARK = [
  "X.............X", "XX...........XX", "XXX.........XXX", "XXXX.......XXXX", ".XXXXXXXXXXXXX.", ".XXXXXXXXXXXXX.", ".XXX.XXXXX.XXX.",
  "XXX.X.XXX.X.XXX", "XXXXXXXXXXXXXXX", ".XXXXXXXXXXXXX.", "...XXXXXXXXX...", ".....XXXXX.....", "......XXX......",
];
const markPath = MARK.map((row, y) => [...row.matchAll(/X+/g)].map((m) => `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`).join("")).join("");
const pipSvg = () => `<svg class="pip" viewBox="0 0 15 13" shape-rendering="crispEdges" aria-hidden="true"><path d="${markPath}" fill="#e8742c"/></svg>`;

const STYLE = `
:root { --px: 4px; --edge: #3a2414; --frame: #9a6438; --frame-hi: #cf9356; --frame-lo: #73472a; --panel: #fbf1d8; --ink: #3a2414; --ink-2: #6b4b31;
  --go: #ffc94a; --go-hi: #ffe38a; --go-lo: #c98a1a; --bad: #b3261e; --ring: 0 calc(var(--px) * -1) 0 0 var(--edge), 0 var(--px) 0 0 var(--edge), calc(var(--px) * -1) 0 0 0 var(--edge), var(--px) 0 0 0 var(--edge); }
* { box-sizing: border-box; margin: 0; }
html, body { height: 100%; }
body { display: grid; place-items: center; padding: 72px 16px 32px; background: linear-gradient(#86c7e6 0 58%, #6fbf4e 58% 62%, #4f9a38 62%);
  color: var(--ink); font: 16px/1.5 "Rubik", "Segoe UI", system-ui, sans-serif; }
main { position: relative; width: min(420px, 100%); padding: 40px 26px 26px; display: flex; flex-direction: column; gap: 14px; background: var(--panel);
  box-shadow: var(--ring), inset var(--px) var(--px) 0 0 var(--frame-hi), inset calc(var(--px) * -1) calc(var(--px) * -1) 0 0 var(--frame-lo), inset 0 0 0 calc(var(--px) * 3) var(--frame); }
.pip { position: absolute; bottom: calc(100% + var(--px) * 2); inset-inline-start: 26px; width: 58px; }
h1 { font-size: 30px; line-height: 1.15; text-align: center; }
p { color: var(--ink-2); text-align: center; }
label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
input { width: 100%; padding: 11px 12px; border: 0; background: #fffaf0; color: var(--ink); font: inherit; direction: ltr;
  box-shadow: 0 calc(var(--px) * -1) 0 0 #b48a5a, 0 var(--px) 0 0 #b48a5a, calc(var(--px) * -1) 0 0 0 #b48a5a, var(--px) 0 0 0 #b48a5a, inset 0 var(--px) 0 0 #ead8b2; }
input:focus { outline: none; box-shadow: 0 calc(var(--px) * -1) 0 0 #367a32, 0 var(--px) 0 0 #367a32, calc(var(--px) * -1) 0 0 0 #367a32, var(--px) 0 0 0 #367a32, inset 0 var(--px) 0 0 #ead8b2; }
button, .go { display: block; width: 100%; min-height: 50px; margin-top: 6px; border: 0; background: var(--go); color: var(--ink); font: 800 20px "Rubik", "Segoe UI", sans-serif;
  text-align: center; text-decoration: none; padding: 12px; cursor: pointer; box-shadow: var(--ring), inset 0 var(--px) 0 0 var(--go-hi), inset 0 calc(var(--px) * -2) 0 0 var(--go-lo); }
button:active { transform: translateY(var(--px)); }
.error { color: var(--bad); font-weight: 600; }
.small { font-size: 14px; }
a { color: var(--ink); }
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${pipSvg()}${body}</main></body></html>`;
}

// The sign-in: the computer's own account, checked by the computer.
export function signInPage({ name = "", error = "" }: { name?: string; error?: string } = {}) {
  return page("פיפ: כניסה", `
<h1>היי, טוב לראות אותך!</h1>
<p>נכנסים עם שם המשתמש והסיסמה של פיפ במחשב שלך. המחשב צריך להיות דלוק, ופיפ פתוח בו.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/login">
  <label>שם משתמש<input name="name" autocomplete="username" required value="${esc(name)}"></label>
  <label style="margin-top:12px">סיסמה<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">כניסה</button>
</form>`);
}

export function offlinePage(name: string) {
  return page("פיפ: המחשב לא מחובר", `
<h1>המחשב לא מחובר</h1>
<p>פיפ של ${esc(name)} לא מחובר עכשיו. כדאי לבדוק שהמחשב דלוק ושפיפ פתוח בו, ולנסות שוב.</p>
<a class="go" href="/">לנסות שוב</a>
<p class="small"><a href="/logout">כניסה עם משתמש אחר</a></p>`);
}
