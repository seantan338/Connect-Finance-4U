import { useEffect, useMemo, useState } from 'react';
import { api, type Account } from '../api.js';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPE_ORDER } from '../ui.js';

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .accounts()
      .then(setAccounts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Account[]>();
    for (const a of accounts) {
      const arr = map.get(a.parentId);
      if (arr) arr.push(a);
      else map.set(a.parentId, [a]);
    }
    return map;
  }, [accounts]);

  if (loading) return <Hint>Loading chart of accounts…</Hint>;
  if (error) return <Hint error>Failed: {error}. 确认 API 在跑且已 seed。</Hint>;
  if (accounts.length === 0) return <Hint>没有科目。先跑 `pnpm --filter @cf4u/db seed`。</Hint>;

  return (
    <div className="space-y-8">
      {ACCOUNT_TYPE_ORDER.map((type) => {
        const roots = (childrenOf.get(null) ?? []).filter((a) => a.accountType === type);
        if (roots.length === 0) return null;
        const meta = ACCOUNT_TYPE_META[type];
        return (
          <section key={type}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${meta.dot}`} />
              <h2 className={`font-mono text-xs tracking-widest uppercase font-semibold ${meta.text}`}>
                {meta.label}
              </h2>
            </div>
            <div className="rounded border border-line bg-panel overflow-hidden">
              {roots.map((r) => (
                <AccountRow key={r.id} account={r} depth={0} childrenOf={childrenOf} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AccountRow({
  account,
  depth,
  childrenOf,
}: {
  account: Account;
  depth: number;
  childrenOf: Map<string | null, Account[]>;
}) {
  const kids = childrenOf.get(account.id) ?? [];
  const isHeader = kids.length > 0;
  return (
    <>
      <div
        className="flex items-center gap-3 px-4 py-2 border-b border-line last:border-b-0 hover:bg-paper"
        style={{ paddingLeft: 16 + depth * 22 }}
      >
        <span className="font-mono text-sm text-slate-500 w-14 shrink-0">{account.code}</span>
        <span className={`text-sm ${isHeader ? 'font-semibold' : ''}`}>{account.name}</span>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-slate-400">
          {account.normalBalance === 'debit' ? 'Dr' : 'Cr'}
        </span>
        {!account.isActive && (
          <span className="text-[10px] font-mono text-debit border border-debit/40 rounded px-1">
            inactive
          </span>
        )}
      </div>
      {kids.map((k) => (
        <AccountRow key={k.id} account={k} depth={depth + 1} childrenOf={childrenOf} />
      ))}
    </>
  );
}

function Hint({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <p className={`font-mono text-sm ${error ? 'text-debit' : 'text-slate-500'}`}>{children}</p>
  );
}
