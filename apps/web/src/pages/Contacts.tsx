import { useEffect, useState } from 'react';
import { api, ApiError, type Contact, type ContactKind, type TaxCode } from '../api.js';

const KINDS: ContactKind[] = ['customer', 'supplier', 'both'];

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ContactKind>('customer');
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = () => {
    api.contacts().then(setContacts).catch((e) => setError(e.message));
    api.taxCodes().then(setTaxCodes).catch(() => {});
  };
  useEffect(reload, []);

  async function add() {
    setBusy(true);
    setFormError(null);
    try {
      await api.createContact({
        kind,
        name,
        tin: tin || undefined,
        email: email || undefined,
      });
      setName('');
      setTin('');
      setEmail('');
      reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <section>
        <h2 className="font-mono text-xs tracking-widest uppercase font-semibold text-ink mb-3">
          Add contact
        </h2>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ContactKind)}
              className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
            />
          </Field>
          <Field label="TIN">
            <input
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              placeholder="optional"
              className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
            />
          </Field>
          <Field label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="optional"
              className="border border-line rounded px-2 py-1.5 text-sm bg-panel"
            />
          </Field>
          <button
            disabled={busy || !name.trim()}
            onClick={add}
            className={`px-4 py-2 rounded text-sm font-semibold ${
              busy || !name.trim()
                ? 'bg-line text-slate-400 cursor-not-allowed'
                : 'bg-ink text-white hover:brightness-125'
            }`}
          >
            Add
          </button>
        </div>
        {formError && <p className="mt-2 font-mono text-sm text-debit">{formError}</p>}
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-widest uppercase font-semibold text-ink mb-2">
          Contacts
        </h2>
        {error && <p className="font-mono text-sm text-debit">Failed: {error}</p>}
        <div className="rounded border border-line bg-panel overflow-hidden">
          <div className="grid grid-cols-[110px_1fr_1fr_1fr] gap-px bg-line text-[11px] font-mono uppercase tracking-wide text-slate-500">
            <div className="bg-paper px-3 py-2">Kind</div>
            <div className="bg-paper px-3 py-2">Name</div>
            <div className="bg-paper px-3 py-2">TIN</div>
            <div className="bg-paper px-3 py-2">Email</div>
          </div>
          {contacts.length === 0 && (
            <div className="px-3 py-6 text-center font-mono text-sm text-slate-400">
              还没有联系人。
            </div>
          )}
          {contacts.map((c) => (
            <div key={c.id} className="grid grid-cols-[110px_1fr_1fr_1fr] gap-px bg-line text-sm">
              <div className="bg-panel px-3 py-1.5 font-mono text-xs text-slate-500">{c.kind}</div>
              <div className="bg-panel px-3 py-1.5">{c.name}</div>
              <div className="bg-panel px-3 py-1.5 font-mono text-xs">{c.tin ?? ''}</div>
              <div className="bg-panel px-3 py-1.5 text-xs">{c.email ?? ''}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-widest uppercase font-semibold text-ink mb-2">
          SST tax codes
        </h2>
        <div className="flex gap-2 flex-wrap">
          {taxCodes.length === 0 && (
            <span className="font-mono text-sm text-slate-400">没有税码。先 seed。</span>
          )}
          {taxCodes.map((t) => (
            <span
              key={t.id}
              className="font-mono text-xs border border-gold/40 bg-gold-soft text-gold rounded px-2 py-1"
            >
              {t.code} · {(Number(t.rate) * 100).toFixed(2)}%
            </span>
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
