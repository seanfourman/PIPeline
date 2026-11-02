import React, { useState } from "react";
import { useApp } from "../app";
import { api, Btn, Card, Page } from "../kit";

const STATUSES = ["drafted", "applied", "interview", "offer", "hired", "rejected", "no_response", "offer_declined", "withdrawn"];
const normal = (status: unknown) => String(status ?? "").toLowerCase().replace(" ", "_");

function Ats({ ats }: { ats: { score: number | null; missing: string[]; problems: string[] } | null }) {
  const { t } = useApp();
  if (!ats) return <td>–</td>;
  const gaps = ats.problems.length ? ats.problems : ats.missing;
  return (
    <td title={t("apps.atsTip")}>
      <strong className="ats-score">{ats.score ?? "–"}</strong>
      {gaps.length > 0 && <div className="note" dir="ltr">{ats.problems.length ? t("apps.problem") : t("apps.missing")}: {gaps.join(", ")}</div>}
    </td>
  );
}

// Only finished documents in the output folders open, as the server allows.
function DocLink({ path, label }: { path: unknown; label: string }) {
  const { s } = useApp();
  const clean = String(path ?? "").trim().replaceAll("\\", "/").replace(/\.tex$/i, ".pdf");
  if (!/^(cv|cover_letters)\/[^/]+\.pdf$/i.test(clean) || !s.files.some((f) => f.path === clean)) return null;
  return <a href={`/file?path=${encodeURIComponent(clean)}`} target="_blank" rel="noopener">{label}</a>;
}

export function Apps() {
  const { s, t, start, refresh, say, err } = useApp();
  const [error, setError] = useState("");
  const apps = [...s.applications].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const change = async (a: Record<string, any>, status: string) => {
    setError("");
    try {
      await api("applications/status", { date: a.date, company: a.company, role: a.role, status });
      await refresh();
      if (["interview", "offer", "hired"].includes(status)) say(t("pip.interview", { company: a.company }), "happy");
      else if (status === "applied") say(t("pip.applied"), "happy");
      else if (status === "rejected" || status === "no_response") say(t("pip.rejected"), "worried");
    } catch (e) {
      setError(err(e));
    }
  };

  return (
    <Page title={t("apps.title")} sub={t("apps.sub", { n: apps.length })} actions={<Btn onClick={() => start("/outcome followup")}>{t("apps.noReply")}</Btn>}>
      {error && <p className="error-line" role="alert" dir="auto">{error}</p>}
      {apps.length ? (
        <Card className="table-wrap">
          <table>
            <thead><tr>{["date", "company", "role", "ats", "status", "docs"].map((c) => <th key={c}>{t(`apps.cols.${c}`)}</th>)}<th /></tr></thead>
            <tbody>
              {apps.map((a) => {
                const current = normal(a.status);
                const options = STATUSES.includes(current) ? STATUSES : [current, ...STATUSES];
                const name = String(a.cv_file ?? "").trim().replaceAll("\\", "/").match(/^cv\/main_([a-z0-9_]+)\.\w+$/)?.[1];
                return (
                  <tr key={`${a.date}|${a.company}|${a.role}`}>
                    <td dir="ltr" className="nowrap">{a.date}</td>
                    <td dir="auto">{a.company}</td>
                    <td dir="auto">{a.role}</td>
                    <Ats ats={a.ats} />
                    <td>
                      <select className={`status status-${current}`} aria-label={`${t("apps.cols.status")}: ${a.company}`} value={current} onChange={(e) => change(a, e.target.value)}>
                        {options.map((o) => <option key={o} value={o}>{t(`status.${o}`)}</option>)}
                      </select>
                    </td>
                    <td><div className="row">
                      <DocLink path={a.cv_file} label={t("apps.cv")} />
                      {name && <a href={`#/cv/${name}`}>{t("common.edit")}</a>}
                      <DocLink path={a.cover_letter_file} label={t("apps.letter")} />
                    </div></td>
                    <td><div className="row end">
                      <Btn onClick={() => start(`/outcome ${a.company} ${a.role}`)}>{t("apps.outcome")}</Btn>
                      <Btn onClick={() => start(`/interview ${a.company} ${a.role}`)}>{t("apps.prep")}</Btn>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="empty">{t("apps.empty")}<a className="btn primary" href="#/jobs">{t("apps.find")}</a></Card>
      )}
      {s.files.length > 0 && (
        <Card>
          <h2>{t("apps.recent")}</h2>
          {s.files.slice(0, 8).map((f) => (
            <a key={f.path} className="list-link" href={`/file?path=${encodeURIComponent(f.path)}`} target="_blank" rel="noopener">
              <span className="ellipsis" dir="ltr">{f.path}</span><span className="note">{new Date(f.modified).toLocaleDateString()}</span>
            </a>
          ))}
        </Card>
      )}
    </Page>
  );
}
