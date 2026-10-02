// Pettycash: staff log expenses with a receipt photo, each one is checked against policy, and the month exports for the accountant.
import { useEffect, useState } from "react";
import { toCsv } from "./lib/csv";
import { idbGet, idbSet, shrinkImage } from "./lib/idb";
import { moneyFmt } from "./lib/money";
import { download, uid, useStored } from "./lib/store";
import { todayISO } from "./lib/time";
import { CurrencySelect, Section, Stat, Stats } from "./ui/kit";

const T = "pettycash";
type Rule = { cat: string; limit: number; receiptOver: number };
type Exp = { id: string; who: string; date: string; cat: string; amount: number; what: string; project: string; photo: boolean; status: "pending" | "approved" | "rejected" };
const RULES: Rule[] = [
  { cat: "Travel", limit: 150, receiptOver: 20 }, { cat: "Meals", limit: 40, receiptOver: 15 }, { cat: "Office supplies", limit: 100, receiptOver: 10 },
  { cat: "Client entertainment", limit: 250, receiptOver: 0 }, { cat: "Software", limit: 80, receiptOver: 0 }, { cat: "Other", limit: 50, receiptOver: 10 },
];
const SAMPLE: Exp[] = [
  { id: "e1", who: "Amira", date: todayISO(), cat: "Meals", amount: 62, what: "Lunch with supplier", project: "Sourcing", photo: false, status: "pending" },
  { id: "e2", who: "Walid", date: todayISO(), cat: "Travel", amount: 38, what: "Taxi to client", project: "Client A", photo: false, status: "pending" },
  { id: "e3", who: "Ines", date: todayISO(), cat: "Office supplies", amount: 9.5, what: "Printer paper", project: "", photo: false, status: "approved" },
];

function Receipt({ id }: { id: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { idbGet(`${T}:${id}`).then(v => setSrc(v ?? "")); }, [id]);
  return src ? <a href={src} target="_blank" rel="noreferrer" className="pc-thumb"><img src={src} alt="Receipt" /></a> : null;
}

export default function Pettycash() {
  const [rules, setRules] = useStored<Rule[]>(T, "rules", RULES);
  const [exps, setExps] = useStored<Exp[]>(T, "exps", SAMPLE);
  const [cur, setCur] = useStored(T, "cur", "TND");
  const [staff, setStaff] = useStored(T, "staff", "Amira, Walid, Ines, Karim");
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [d, setD] = useState({ who: "Amira", date: todayISO(), cat: "Meals", amount: "", what: "", project: "" });
  const [file, setFile] = useState<File | null>(null);
  const money = moneyFmt(cur);
  const people = staff.split(",").map(s => s.trim()).filter(Boolean);

  const flags = (e: Exp) => {
    const r = rules.find(x => x.cat === e.cat); const out: string[] = [];
    if (r && e.amount > r.limit) out.push(`Over the ${money(r.limit)} limit`);
    if (r && e.amount > r.receiptOver && !e.photo) out.push("Receipt needed");
    if (!e.what.trim()) out.push("No description");
    if (e.date > todayISO()) out.push("Date in the future");
    const dup = exps.find(x => x.id !== e.id && x.who === e.who && x.amount === e.amount && x.date === e.date);
    if (dup) out.push("Possible duplicate");
    return out;
  };
  const list = exps.filter(e => e.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const pending = list.filter(e => e.status === "pending");
  const byCat = rules.map(r => ({ cat: r.cat, total: list.filter(e => e.cat === r.cat && e.status !== "rejected").reduce((a, e) => a + e.amount, 0) })).filter(x => x.total);
  const byWho = people.map(p => ({ p, total: list.filter(e => e.who === p && e.status === "approved").reduce((a, e) => a + e.amount, 0) })).filter(x => x.total);
  const add = async (ev: React.FormEvent) => {
    ev.preventDefault(); const amount = parseFloat(d.amount.replace(",", ".")); if (!amount) return;
    const id = uid(); let photo = false;
    if (file) { await idbSet(`${T}:${id}`, await shrinkImage(file, 1200, 0.8)); photo = true; }
    setExps([{ id, ...d, amount, photo, status: "pending" }, ...exps]); setD({ ...d, amount: "", what: "" }); setFile(null);
  };
  const setStatus = (id: string, status: Exp["status"]) => setExps(exps.map(x => (x.id === id ? { ...x, status } : x)));

  return (
    <div className="stack">
      <Section title="Expenses" aside={<><input id="pc-month" type="month" className="input" style={{ width: "auto" }} value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" /><CurrencySelect id="pc-cur" value={cur} onChange={setCur} /></>}>
        <Stats><Stat value={money(list.filter(e => e.status !== "rejected").reduce((a, e) => a + e.amount, 0))} label="This month" /><Stat value={pending.length} label="Waiting for approval" tone={pending.length ? "warn" : undefined} /><Stat value={list.filter(e => flags(e).length).length} label="Break a rule" tone={list.some(e => flags(e).length) ? "bad" : "good"} /></Stats>
      </Section>
      <div className="grid2">
        <Section title="Log an expense">
          <form className="stack" style={{ gap: 10 }} onSubmit={add}>
            <div className="row"><label className="field"><span>Who</span><select id="pc-who" className="input" value={d.who} onChange={e => setD({ ...d, who: e.target.value })}>{people.map(p => <option key={p}>{p}</option>)}</select></label><label className="field"><span>Amount</span><input id="pc-amt" className="input num" inputMode="decimal" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></label></div>
            <div className="row"><label className="field"><span>Category</span><select id="pc-cat" className="input" value={d.cat} onChange={e => setD({ ...d, cat: e.target.value })}>{rules.map(r => <option key={r.cat}>{r.cat}</option>)}</select></label><label className="field"><span>Date</span><input id="pc-date" type="date" className="input" value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></label></div>
            <div className="row"><label className="field"><span>What for</span><input id="pc-what" className="input" value={d.what} onChange={e => setD({ ...d, what: e.target.value })} /></label><label className="field"><span>Project (optional)</span><input id="pc-proj" className="input" value={d.project} onChange={e => setD({ ...d, project: e.target.value })} /></label></div>
            <div className="row" style={{ alignItems: "center" }}><label className="btn small">{file ? "Photo added" : "Photo of the receipt"}<input type="file" accept="image/*" capture="environment" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><button className="btn primary" type="submit">Submit</button></div>
            {(() => { const r = rules.find(x => x.cat === d.cat); const a = parseFloat(d.amount) || 0; return r && a ? <p className="note">{a > r.limit ? <span className="pill bad">Over the {money(r.limit)} limit for {r.cat.toLowerCase()}</span> : a > r.receiptOver && !file ? <span className="pill warn">A receipt photo is required above {money(r.receiptOver)}</span> : <span className="pill good">Within policy</span>}</p> : null; })()}
          </form>
        </Section>
        <Section title="Totals">
          <p className="eyebrow">By category</p>
          <table className="t" style={{ marginBottom: 14 }}><tbody>{byCat.map(x => <tr key={x.cat}><td>{x.cat}</td><td className="r">{money(x.total)}</td></tr>)}</tbody></table>
          <p className="eyebrow">Approved, to reimburse</p>
          <table className="t"><tbody>{byWho.map(x => <tr key={x.p}><td>{x.p}</td><td className="r"><strong>{money(x.total)}</strong></td></tr>)}</tbody></table>
        </Section>
      </div>
      <Section title="Review" aside={<button className="btn small primary" onClick={() => download(`expenses-${month}.csv`, toCsv([["Date", "Employee", "Category", "Description", "Project", "Amount", "Currency", "Receipt", "Status", "Policy flags"], ...list.map(e => [e.date, e.who, e.cat, e.what, e.project, e.amount.toFixed(2), cur, e.photo ? "yes" : "no", e.status, flags(e).join("; ")])]), "text/csv")}>Export for the accountant</button>}>
        {list.length === 0 ? <p className="empty-note">No expenses this month.</p> : list.map(e => { const f = flags(e); return (
          <div key={e.id} className="pc-row" style={{ borderLeftColor: e.status === "approved" ? "var(--good)" : e.status === "rejected" ? "var(--line)" : f.length ? "var(--bad)" : "var(--warn)" }}>
            {e.photo && <Receipt id={e.id} />}
            <div style={{ flex: 1, minWidth: 0 }}><strong>{money(e.amount)}</strong> · {e.what || "No description"} <span className="note">{e.who} · {e.cat} · {e.date}{e.project && ` · ${e.project}`}</span>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>{f.map(x => <span key={x} className="pill bad">{x}</span>)}</div></div>
            {e.status === "pending" ? <><button className="btn small primary" onClick={() => setStatus(e.id, "approved")}>Approve</button><button className="btn small" onClick={() => setStatus(e.id, "rejected")}>Reject</button></> : <span className={"pill " + (e.status === "approved" ? "good" : "")}>{e.status}</span>}
            <button className="btn ghost small danger" onClick={() => setExps(exps.filter(x => x.id !== e.id))}>Delete</button>
          </div>); })}
      </Section>
      <Section title="Policy">
        <div className="table-wrap"><table className="t"><thead><tr><th>Category</th><th className="r">Limit per expense</th><th className="r">Receipt required above</th></tr></thead>
          <tbody>{rules.map(r => <tr key={r.cat}><td>{r.cat}</td><td><input className="input num" aria-label="Limit" value={r.limit} onChange={e => setRules(rules.map(x => x.cat === r.cat ? { ...x, limit: parseFloat(e.target.value) || 0 } : x))} /></td><td><input className="input num" aria-label="Receipt threshold" value={r.receiptOver} onChange={e => setRules(rules.map(x => x.cat === r.cat ? { ...x, receiptOver: parseFloat(e.target.value) || 0 } : x))} /></td></tr>)}</tbody></table></div>
        <label className="field" style={{ marginTop: 12 }}><span>Staff, separated by commas</span><input id="pc-staff" className="input" value={staff} onChange={e => setStaff(e.target.value)} /></label>
      </Section>
      <style>{`.pc-row{display:flex;gap:12px;align-items:center;padding:10px 0 10px 12px;border-left:4px solid;border-bottom:1px solid var(--line);flex-wrap:wrap}.pc-thumb img{width:48px;height:48px;object-fit:cover;border-radius:6px;display:block}`}</style>
    </div>
  );
}
