import { useEffect, useState } from 'react';
import { api, type Period, type TrialBalance } from '../api.js';

export default function TrialBalancePage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<string>('');
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .periods()
      .then((ps) => {
        setPeriods(ps);
        const open = ps.find((p) => p.status === 'open') ?? ps[0];
        if (open) setPeriodId(open.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!periodId) return;
    setError(null);
    api.trialBalance(periodId).then(setTb).catch((e) => setError(e.message));
  }, [periodId]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">Period</span>
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.periodStart} … {p.periodEnd} ({p.status})
            </option>
          ))}
        </select>
        {tb && <span className="font-mono text-xs text-slate-400">as at {tb.asOf}</span>}
      </div>

      {error && <p className="font-mono text-sm text-debit">Failed: {error}</p>}

      {tb && (
        <div className="rounded border border-line bg-panel overflow-hidden">
          <div className="grid grid-cols-[80px_1fr_140px_140px] gap-px bg-line text-[11px] font-mono uppercase tracking-wide text-slate-500">
            <div className="bg-paper px-3 py-2">Code</div>
            <div className="bg-paper px-3 py-2">Account</div>
            <div className="bg-paper px-3 py-2 text-right">Debit</div>
            <div className="bg-paper px-3 py-2 text-right">Credit</div>
          </div>
          {tb.rows.length === 0 && (
            <div className="px-3 py-6 text-center font-mono text-sm text-slate-400">
              该期间没有 posted 分录。
            </div>
          )}
          {tb.rows.map((r) => (
            <div
              key={r.accountId}
              className="grid grid-cols-[80px_1fr_140px_140px] gap-px bg-line text-sm"
            >
              <div className="bg-panel px-3 py-1.5 font-mono text-slate-500">{r.code}</div>
              <div className="bg-panel px-3 py-1.5">{r.name}</div>
              <div className="bg-panel px-3 py-1.5 text-right font-mono">
                {r.debit === '0.0000' ? '' : r.debit}
              </div>
              <div className="bg-panel px-3 py-1.5 text-right font-mono">
                {r.credit === '0.0000' ? '' : r.credit}
              </div>
            </div>
          ))}
          {/* 底部断言 Σdebit = Σcredit */}
          <div
            className={`grid grid-cols-[80px_1fr_140px_140px] gap-px ${
              tb.balanced ? 'bg-credit' : 'bg-debit'
            }`}
          >
            <div className="col-span-2 px-3 py-2 text-white font-semibold text-sm">
              {tb.balanced ? '✓ Balanced — Σ Debit = Σ Credit' : '✗ OUT OF BALANCE'}
            </div>
            <div className="px-3 py-2 text-right font-mono font-semibold text-white">
              {tb.totalDebit}
            </div>
            <div className="px-3 py-2 text-right font-mono font-semibold text-white">
              {tb.totalCredit}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
