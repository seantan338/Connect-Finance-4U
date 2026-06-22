import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Account } from '../api.js';
import { formatMoney, parseMoney, subMoney, sumMoney, type Money } from '@cf4u/core/money';

interface Row {
  accountId: string;
  debit: string;
  credit: string;
}

const emptyRow = (): Row => ({ accountId: '', debit: '', credit: '' });
const today = () => new Date().toISOString().slice(0, 10);

/** '' → 0;合法 → Money;非法 → null。 */
function safeParse(s: string): Money | null {
  if (s.trim() === '') return 0n;
  try {
    return parseMoney(s);
  } catch {
    return null;
  }
}

export default function NewJournalEntry() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.accounts().then((a) => setAccounts(a.filter((x) => x.isActive))).catch(() => {});
  }, []);

  const calc = useMemo(() => {
    let parseError = false;
    let rowError = false;
    let valued = 0;
    let missingAccount = false;
    const debits: Money[] = [];
    const credits: Money[] = [];
    for (const r of rows) {
      const d = safeParse(r.debit);
      const c = safeParse(r.credit);
      if (d === null || c === null) {
        parseError = true;
        continue;
      }
      if (d > 0n && c > 0n) rowError = true; // 一行不能同时借贷
      if (d > 0n || c > 0n) {
        valued++;
        if (!r.accountId) missingAccount = true;
      }
      debits.push(d);
      credits.push(c);
    }
    const totalDebit = sumMoney(debits);
    const totalCredit = sumMoney(credits);
    const diff = subMoney(totalDebit, totalCredit);
    const balanced = diff === 0n && totalDebit > 0n;
    const canSubmit =
      balanced && !parseError && !rowError && !missingAccount && valued >= 2;
    return { totalDebit, totalCredit, diff, balanced, canSubmit };
  }, [rows]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(post: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const lines = rows
        .filter((r) => safeParse(r.debit) || safeParse(r.credit))
        .filter((r) => (safeParse(r.debit) || 0n) > 0n || (safeParse(r.credit) || 0n) > 0n)
        .map((r) => ({
          accountId: r.accountId,
          debit: r.debit.trim() || undefined,
          credit: r.credit.trim() || undefined,
        }));
      const res = await api.createEntry({ entryDate, memo: memo || undefined, post, lines });
      setResult(`Entry #${res.entryNo} ${res.posted ? 'posted ✓' : 'saved as draft'}`);
      setRows([emptyRow(), emptyRow()]);
      setMemo('');
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  const diffStr = formatMoney(calc.diff);
  const balanced = calc.balanced;

  return (
    <div className="max-w-3xl">
      <div className="flex gap-4 mb-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">Date</span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">Memo</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="optional"
            className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
          />
        </label>
      </div>

      <div className="rounded border border-line bg-panel overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_140px_32px] gap-px bg-line text-[11px] font-mono uppercase tracking-wide text-slate-500">
          <div className="bg-paper px-3 py-2">Account</div>
          <div className="bg-paper px-3 py-2 text-right">Debit</div>
          <div className="bg-paper px-3 py-2 text-right">Credit</div>
          <div className="bg-paper" />
        </div>
        {rows.map((r, i) => {
          const d = safeParse(r.debit);
          const c = safeParse(r.credit);
          const bad = d === null || c === null || (!!d && d > 0n && !!c && c > 0n);
          return (
            <div key={i} className="grid grid-cols-[1fr_140px_140px_32px] gap-px bg-line">
              <select
                value={r.accountId}
                onChange={(e) => update(i, { accountId: e.target.value })}
                className="bg-panel px-3 py-1.5 text-sm outline-none"
              >
                <option value="">— select account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              <input
                value={r.debit}
                onChange={(e) => update(i, { debit: e.target.value, credit: '' })}
                placeholder="0.00"
                className={`bg-panel px-3 py-1.5 text-sm text-right font-mono outline-none ${d === null ? 'text-debit' : ''}`}
              />
              <input
                value={r.credit}
                onChange={(e) => update(i, { credit: e.target.value, debit: '' })}
                placeholder="0.00"
                className={`bg-panel px-3 py-1.5 text-sm text-right font-mono outline-none ${c === null ? 'text-debit' : ''}`}
              />
              <button
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}
                className={`bg-panel text-slate-400 hover:text-debit ${bad ? 'text-debit' : ''}`}
                title="remove line"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setRows((rs) => [...rs, emptyRow()])}
        className="mt-2 font-mono text-xs text-slate-500 hover:text-ink"
      >
        + add line
      </button>

      {/* 实时合计 + 差额(铁律 3 · 第 4 层) */}
      <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-sm">
        <Totals label="Σ Debit" value={formatMoney(calc.totalDebit)} />
        <Totals label="Σ Credit" value={formatMoney(calc.totalCredit)} />
        <div
          className={`rounded px-3 py-2 border ${
            balanced
              ? 'bg-credit-soft border-credit text-credit'
              : 'bg-debit-soft border-debit text-debit'
          }`}
        >
          <div className="text-[11px] uppercase tracking-wide opacity-70">Difference</div>
          <div className="text-base font-semibold">{diffStr}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={!calc.canSubmit || busy}
          onClick={() => submit(true)}
          className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
            calc.canSubmit && !busy
              ? 'bg-credit text-white hover:brightness-110'
              : 'bg-debit/15 text-debit cursor-not-allowed'
          }`}
        >
          {busy ? 'Posting…' : 'Post entry'}
        </button>
        <button
          disabled={!calc.canSubmit || busy}
          onClick={() => submit(false)}
          className={`px-4 py-2 rounded text-sm border ${
            calc.canSubmit && !busy
              ? 'border-ink text-ink hover:bg-ink hover:text-white'
              : 'border-line text-slate-300 cursor-not-allowed'
          }`}
        >
          Save draft
        </button>
        {!balanced && (
          <span className="font-mono text-xs text-debit">差额 ≠ 0,无法过账</span>
        )}
      </div>

      {result && <p className="mt-3 font-mono text-sm text-credit">{result}</p>}
      {error && <p className="mt-3 font-mono text-sm text-debit">{error}</p>}
    </div>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded px-3 py-2 border border-line bg-panel">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
