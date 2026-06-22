import { useState } from 'react';
import ChartOfAccounts from './pages/ChartOfAccounts.js';
import NewJournalEntry from './pages/NewJournalEntry.js';
import TrialBalancePage from './pages/TrialBalancePage.js';
import Contacts from './pages/Contacts.js';
import Invoices from './pages/Invoices.js';
import Reports from './pages/Reports.js';

type Tab = 'coa' | 'contacts' | 'invoices' | 'entry' | 'tb' | 'reports';

const TABS: { id: Tab; label: string }[] = [
  { id: 'coa', label: 'Chart of Accounts' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'entry', label: 'New Journal Entry' },
  { id: 'tb', label: 'Trial Balance' },
  { id: 'reports', label: 'Reports' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('coa');
  return (
    <div className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <p className="font-mono text-[11px] tracking-widest uppercase text-gold">
            Ledger Project · Phase 1 · M1.1
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Connect Finance 4U</h1>
        </div>
        <nav className="max-w-5xl mx-auto px-6 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-gold text-paper'
                  : 'border-transparent text-paper/50 hover:text-paper/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {tab === 'coa' && <ChartOfAccounts />}
        {tab === 'contacts' && <Contacts />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'entry' && <NewJournalEntry />}
        {tab === 'tb' && <TrialBalancePage />}
        {tab === 'reports' && <Reports />}
      </main>
    </div>
  );
}
