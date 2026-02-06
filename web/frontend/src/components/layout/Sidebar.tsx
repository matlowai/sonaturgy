'use client';

import { useUIStore } from '@/stores/uiStore';
import { ServiceConfig } from '@/components/service/ServiceConfig';
import { LoRAPanel } from '@/components/service/LoRAPanel';

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();

  return (
    <>
      <button
        onClick={toggleSidebar}
        className="fixed top-2 left-2 z-30 btn btn-secondary btn-sm md:hidden"
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>
      <aside
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } fixed md:relative z-20 md:translate-x-0 transition-transform duration-200 overflow-y-auto`}
        style={{
          width: '320px',
          minWidth: '320px',
          height: 'calc(100vh - 45px)',
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <div className="p-3 space-y-3">
          <ServiceConfig />
          <LoRAPanel />
        </div>
      </aside>
    </>
  );
}
