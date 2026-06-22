import { useEffect, useState } from 'react';
import { api, type BalanceSheet, type Period, type ProfitAndLoss, type StatementRow } from '../api.js';

type View = 'pl' | 'bs';

export default function Reports() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [view, setView] = useState<View>('pl');
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
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
    api.profitAndLoss(periodId).then(setPl).catch((e) => setError(e.message));
    api.balanceSheet(periodId).then(setBs).catch((e) => setError(e.message));
  }, [periodId]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 rounded border border-line overflow-hidden">
          <Toggle active={view === 'pl'} onClick={() => setView('pl')}>
            Profit &amp; Loss
          </Toggle>
          <Toggle active={view === 'bs'} onClick={() => setView('bs')}>
            Balance Sheet
          </Toggle>
        </div>
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="border border-line rounded px-2 py-1.5 text-sm bg-panel ml-auto"
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.periodStart} … {p.periodEnd}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="font-mono text-sm text-debit">Failed: {error}</p>}

      {view === 'pl' && pl && (
        <div className="rounded border border-line bg-panel">
          <Section title="Income" rows={pl.income} />
          <TotalLine label="Total income" value={pl.totalIncome} />
          <Section title="Expense" rows={pl.expense} />
          <TotalLine label="Total expense" value={pl.totalExpense} />
          <div className={`flex justify-between px-4 py-3 font-semibold text-white ${Number(pl.netProfit) >= 0 ? 'bg-credit' : 'bg-debit'}`}>
            <span>Net {Number(pl.netProfit) >= 0 ? 'profit' : 'loss'}</span>
            <span className="font-mono">{pl.netProfit}</span>
          </div>
        </div>
      )}

      {view === 'bs' && bs && (
        <div className="rounded border border-line bg-panel">
          <Section title="Assets" rows={bs.assets} />
          <TotalLine label="Total assets" value={bs.totalAssets} />
          <Section title="Liabilities" rows={bs.liabilities} />
          <TotalLine label="Total liabilities" value={bs.totalLiabilities} />
          <Section
            title="Equity"
            rows={[
              ...bs.equity,
              { accountId: 'cye', code: '', name: 'Current Year Earnings (computed)', amount: bs.currentYearEarnings },
            ]}
          />
          <TotalLine label="Total equity" value={bs.totalEquity} />
          <div className={`flex justify-between px-4 py-3 font-semibold text-white ${bs.balanced ? 'bg-credit' : 'bg-debit'}`}>
            <span>{bs.balanced ? '✓ Assets = Liabilities + Equity' : '✗ OUT OF BALANCE'}</span>
            <span className="font-mono">
              {bs.totalAssets} = {bs.totalLiabilities} + {bs.totalEquity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: StatementRow[] }) {
  return (
    <div>
      <div className="px-4 py-2 bg-paper font-mono text-[11px] uppercase tracking-widest text-slate-500 border-b border-line">
        {title}
      </div>
      {rows.length === 0 && <div className="px-4 py-2 text-sm text-slate-400">—</div>}
      {rows.map((r) => (
        <div key={r.accountId} className="flex justify-between px-4 py-1.5 text-sm border-b border-line/60">
          <span>
            {r.code && <span className="font-mono text-xs text-slate-400 mr-2">{r.code}</span>}
            {r.name}
          </span>
          <span className="font-mono">{r.amount}</span>
        </div>
      ))}
    </div>
  );
}

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-4 py-2 text-sm font-semibold bg-paper border-b border-line">
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm ${active ? 'bg-ink text-white' : 'bg-panel text-slate-500 hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
