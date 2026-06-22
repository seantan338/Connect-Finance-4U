import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type Account,
  type Contact,
  type Invoice,
  type TaxCode,
} from '../api.js';
import { applyRate, formatMoney, mulMoney, parseMoney, type Money } from '@cf4u/core/money';

type Direction = 'sales' | 'purchase';
interface LineRow {
  description: string;
  qty: string;
  unitPrice: string;
  accountId: string;
  taxCodeId: string;
}
const emptyLine = (): LineRow => ({ description: '', qty: '1', unitPrice: '', accountId: '', taxCodeId: '' });
const today = () => new Date().toISOString().slice(0, 10);

function safeParse(s: string, fallback = '0'): Money | null {
  const v = s.trim() === '' ? fallback : s.trim();
  try {
    return parseMoney(v);
  } catch {
    return null;
  }
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction>('sales');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = () => {
    api.invoices().then(setInvoices).catch((e) => setError(e.message));
  };
  useEffect(() => {
    reload();
    api.accounts().then((a) => setAccounts(a.filter((x) => x.isActive))).catch(() => {});
    api.contacts().then(setContacts).catch(() => {});
    api.taxCodes().then(setTaxCodes).catch(() => {});
  }, []);

  const eligibleContacts = useMemo(() => {
    const want = direction === 'sales' ? 'customer' : 'supplier';
    return contacts.filter((c) => c.kind === want || c.kind === 'both');
  }, [contacts, direction]);

  const totals = useMemo(() => {
    let subtotal: Money = 0n;
    let tax: Money = 0n;
    let bad = false;
    for (const l of lines) {
      const qty = safeParse(l.qty, '1');
      const unit = safeParse(l.unitPrice, '0');
      if (qty === null || unit === null) {
        bad = true;
        continue;
      }
      const lineTotal = mulMoney(qty, unit);
      const rate = taxCodes.find((t) => t.id === l.taxCodeId)?.rate ?? '0';
      subtotal += lineTotal;
      tax += applyRate(lineTotal, rate);
    }
    return { subtotal, tax, grand: subtotal + tax, bad };
  }, [lines, taxCodes]);

  const valuedLines = lines.filter((l) => {
    const u = safeParse(l.unitPrice, '0');
    return u !== null && u > 0n && l.accountId;
  });
  const canSubmit =
    !totals.bad && totals.grand > 0n && invoiceNo.trim() !== '' && contactId !== '' && valuedLines.length > 0;

  const update = (i: number, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(issue: boolean) {
    setBusy(true);
    setFormError(null);
    setMsg(null);
    try {
      const res = await api.createInvoice({
        direction,
        invoiceNo,
        contactId,
        issueDate,
        issue,
        lines: valuedLines.map((l) => ({
          description: l.description || '—',
          qty: l.qty || '1',
          unitPrice: l.unitPrice,
          accountId: l.accountId,
          taxCodeId: l.taxCodeId || undefined,
        })),
      });
      setMsg(`Invoice ${res.invoiceNo} ${issue ? 'issued ✓ (posted)' : 'saved as draft'} · grand ${res.grandTotal}`);
      setInvoiceNo('');
      setContactId('');
      setLines([emptyLine()]);
      reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function issueExisting(id: string) {
    setError(null);
    try {
      await api.issueInvoice(id);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  return (
    <div className="space-y-8">
      <section className="max-w-3xl">
        <h2 className="font-mono text-xs tracking-widest uppercase font-semibold text-ink mb-3">
          New invoice
        </h2>
        <div className="flex flex-wrap gap-3 mb-3">
          <Field label="Direction">
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as Direction);
                setContactId('');
              }}
              className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
            >
              <option value="sales">sales</option>
              <option value="purchase">purchase</option>
            </select>
          </Field>
          <Field label="Invoice No">
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="border border-line rounded px-2 py-1.5 text-sm bg-panel" />
          </Field>
          <Field label={direction === 'sales' ? 'Customer' : 'Supplier'}>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="border border-line rounded px-2 py-1.5 text-sm bg-panel">
              <option value="">— select —</option>
              {eligibleContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="border border-line rounded px-2 py-1.5 text-sm bg-panel" />
          </Field>
        </div>

        <div className="rounded border border-line bg-panel overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_110px_1fr_120px_28px] gap-px bg-line text-[11px] font-mono uppercase tracking-wide text-slate-500">
            <div className="bg-paper px-2 py-2">Description</div>
            <div className="bg-paper px-2 py-2 text-right">Qty</div>
            <div className="bg-paper px-2 py-2 text-right">Unit</div>
            <div className="bg-paper px-2 py-2">Account</div>
            <div className="bg-paper px-2 py-2">Tax</div>
            <div className="bg-paper" />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_110px_1fr_120px_28px] gap-px bg-line">
              <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} className="bg-panel px-2 py-1.5 text-sm outline-none" />
              <input value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} className="bg-panel px-2 py-1.5 text-sm text-right font-mono outline-none" />
              <input value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} placeholder="0.00" className="bg-panel px-2 py-1.5 text-sm text-right font-mono outline-none" />
              <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className="bg-panel px-2 py-1.5 text-sm outline-none">
                <option value="">— account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              <select value={l.taxCodeId} onChange={(e) => update(i, { taxCodeId: e.target.value })} className="bg-panel px-2 py-1.5 text-sm outline-none">
                <option value="">no tax</option>
                {taxCodes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                  </option>
                ))}
              </select>
              <button onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} className="bg-panel text-slate-400 hover:text-debit">
                ×
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 font-mono text-xs text-slate-500 hover:text-ink">
          + add line
        </button>

        <div className="mt-4 flex gap-6 font-mono text-sm">
          <span>Subtotal <b>{formatMoney(totals.subtotal)}</b></span>
          <span>SST <b>{formatMoney(totals.tax)}</b></span>
          <span className="text-ink">Grand <b>{formatMoney(totals.grand)}</b></span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={!canSubmit || busy}
            onClick={() => submit(true)}
            className={`px-4 py-2 rounded text-sm font-semibold ${canSubmit && !busy ? 'bg-credit text-white hover:brightness-110' : 'bg-debit/15 text-debit cursor-not-allowed'}`}
          >
            {busy ? 'Working…' : 'Save & issue'}
          </button>
          <button
            disabled={!canSubmit || busy}
            onClick={() => submit(false)}
            className={`px-4 py-2 rounded text-sm border ${canSubmit && !busy ? 'border-ink text-ink hover:bg-ink hover:text-white' : 'border-line text-slate-300 cursor-not-allowed'}`}
          >
            Save draft
          </button>
        </div>
        {msg && <p className="mt-3 font-mono text-sm text-credit">{msg}</p>}
        {formError && <p className="mt-3 font-mono text-sm text-debit">{formError}</p>}
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-widest uppercase font-semibold text-ink mb-2">
          Invoices
        </h2>
        {error && <p className="font-mono text-sm text-debit">{error}</p>}
        <div className="rounded border border-line bg-panel overflow-hidden">
          <div className="grid grid-cols-[90px_120px_1fr_110px_110px_90px] gap-px bg-line text-[11px] font-mono uppercase tracking-wide text-slate-500">
            <div className="bg-paper px-3 py-2">No</div>
            <div className="bg-paper px-3 py-2">Dir / Party</div>
            <div className="bg-paper px-3 py-2" />
            <div className="bg-paper px-3 py-2 text-right">Grand</div>
            <div className="bg-paper px-3 py-2">Status</div>
            <div className="bg-paper px-3 py-2" />
          </div>
          {invoices.length === 0 && (
            <div className="px-3 py-6 text-center font-mono text-sm text-slate-400">还没有发票。</div>
          )}
          {invoices.map((inv) => (
            <div key={inv.id} className="grid grid-cols-[90px_120px_1fr_110px_110px_90px] gap-px bg-line text-sm">
              <div className="bg-panel px-3 py-1.5 font-mono text-xs">{inv.invoiceNo}</div>
              <div className="bg-panel px-3 py-1.5 text-xs">
                <span className={inv.direction === 'sales' ? 'text-credit' : 'text-debit'}>{inv.direction}</span>
              </div>
              <div className="bg-panel px-3 py-1.5">{inv.contactName}</div>
              <div className="bg-panel px-3 py-1.5 text-right font-mono">{inv.grandTotal}</div>
              <div className="bg-panel px-3 py-1.5">
                <span className={`font-mono text-[11px] uppercase ${inv.status === 'issued' ? 'text-credit' : inv.status === 'draft' ? 'text-gold' : 'text-slate-400'}`}>
                  {inv.status}
                </span>
              </div>
              <div className="bg-panel px-3 py-1.5 text-right">
                {inv.status === 'draft' && (
                  <button onClick={() => issueExisting(inv.id)} className="font-mono text-xs text-ink hover:underline">
                    issue →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
