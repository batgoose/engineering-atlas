'use client';

import { useState } from 'react';
import { getFrameworkOptions } from '@atlas/ui/contracts';
import { nav, cards, typography } from '@atlas/ui/styles';

export function FrameworkSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const frameworks = getFrameworkOptions();
  const current = frameworks.find((f) => f.active)!;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen && (
        <div className={nav.switcherDropdown}>
          <p className={`px-3 py-1 ${typography.caption} uppercase tracking-wider`}>
            View in
          </p>
          {frameworks.map((fw) => (
            <button
              key={fw.id}
              disabled={!fw.active}
              onClick={() => fw.active && setIsOpen(false)}
              className={
                fw.id === current.id
                  ? nav.switcherItemActive
                  : fw.active
                  ? nav.switcherItem
                  : nav.switcherItemDisabled
              }
            >
              <span className={cards.iconBoxSmall}>{fw.icon}</span>
              {fw.name}
              {fw.id === current.id && (
                <span className={`ml-auto ${typography.accent}`}>✓</span>
              )}
              {!fw.active && (
                <span className={`ml-auto ${typography.caption}`}>soon</span>
              )}
            </button>
          ))}
        </div>
      )}

      <button onClick={() => setIsOpen(!isOpen)} className={nav.switcherBtn}>
        <span className={cards.iconBoxSmall}>{current.icon}</span>
        <span className="text-sm font-medium">{current.name}</span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
