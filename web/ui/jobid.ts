// A job's own id, the same in the page and on the server (postings.ts): a short hash of its link, made plain first,
// so the link one list gives with tracking words and another gives without are the same job.

// Words a link carries only to say where it was clicked. LinkedIn's job pages are told apart by their path alone.
const TRACKING = /^(utm_[\w-]+|gh_src|lever-(source|origin)|refid|trackingid|trk)$/i;

export function plainUrl(url: string) {
  let u: URL;
  try { u = new URL(String(url ?? "").trim()); } catch { return ""; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^[a-z]{2}\.linkedin\.com$/, "linkedin.com");
  const query = host === "linkedin.com" ? [] : [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `https://${host}${u.pathname.replace(/\/+$/, "")}${query.length ? `?${new URLSearchParams(query)}` : ""}`;
}

// cyrb53, a small fast hash: 53 bits, plenty to tell a few thousand links apart.
function cyrb53(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// "" for a link that isn't a web page's.
export const jobId = (url: string) => {
  const plain = plainUrl(url);
  return plain ? cyrb53(plain).toString(36) : "";
};
export const JOB_ID = /^[0-9a-z]{1,12}$/;
