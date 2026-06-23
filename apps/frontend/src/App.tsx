import { useState } from 'react';
import { AppShell, type TabId } from './components/AppShell.js';
import { Landing } from './panels/Landing.js';
import { Dashboard } from './panels/Dashboard.js';
import { Funding } from './panels/Funding.js';
import { Analyzer } from './panels/Analyzer.js';
import { VaultCredit } from './panels/VaultCredit.js';
import { AgentInsights } from './panels/AgentInsights.js';
import { Allocator } from './panels/Allocator.js';
import { AuditLog } from './panels/AuditLog.js';
import { Country } from './panels/Country.js';

export interface CountryPrefill { toEntityId?: string; amount?: string }

export default function App() {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState<TabId>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<{ entityId: string; prefill?: CountryPrefill } | null>(null);
  const onChange = () => setRefreshKey((k) => k + 1);

  // open a country detail view, optionally pre-filling its "send" form (used by the AIs)
  const openCountry = (entityId: string, prefill?: CountryPrefill) => {
    setSelected({ entityId, prefill });
    setTab('country');
  };

  if (!entered) return <Landing onEnter={() => setEntered(true)} />;

  return (
    <AppShell active={tab} onTab={setTab} onHome={() => setEntered(false)} refreshKey={refreshKey}>
      {tab === 'dashboard' && <Dashboard refreshKey={refreshKey} openCountry={openCountry} />}
      {tab === 'funding' && <Funding refreshKey={refreshKey} onChange={onChange} />}
      {tab === 'analyzer' && <Analyzer refreshKey={refreshKey} openCountry={openCountry} />}
      {tab === 'vault' && <VaultCredit refreshKey={refreshKey} onChange={onChange} />}
      {tab === 'agent' && <AgentInsights refreshKey={refreshKey} onChange={onChange} />}
      {tab === 'allocator' && <Allocator refreshKey={refreshKey} onChange={onChange} />}
      {tab === 'audit' && <AuditLog refreshKey={refreshKey} />}
      {tab === 'country' && selected && (
        <Country
          key={selected.entityId}
          entityId={selected.entityId}
          prefill={selected.prefill}
          refreshKey={refreshKey}
          onChange={onChange}
        />
      )}
    </AppShell>
  );
}
