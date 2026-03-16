'use client';

import { useState } from 'react';
import type { GridstreamPlayerContract, DeadMoneyScenarios } from '@atlas/sdk/gridstream';

type Scenario = keyof DeadMoneyScenarios;

const SCENARIO_OPTIONS: { value: Scenario; label: string }[] = [
  { value: 'cut', label: 'Cut (pre-June 1)' },
  { value: 'june1Cut', label: 'Cut (post-June 1)' },
  { value: 'trade', label: 'Trade (pre-June 1)' },
  { value: 'june1Trade', label: 'Trade (post-June 1)' },
  { value: 'restructure', label: 'Restructure' },
  { value: 'extension', label: 'Extension' },
];

function fmtMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

interface ContractDetailsProps {
  contracts: GridstreamPlayerContract[];
}

export default function ContractDetails({ contracts }: ContractDetailsProps) {
  const [scenario, setScenario] = useState<Scenario>('cut');

  const currentYear = new Date().getFullYear();

  // Does any active contract have future dead money data?
  const hasDeadMoney = contracts.some(
    (c) =>
      c.isActive &&
      c.yearDetails?.some((d) => d.year >= currentYear && (d.deadMoney || d.capSavings))
  );

  const careerTotal = contracts.reduce((sum, c) => sum + (c.totalValue ?? 0), 0);

  return (
    <details className="hud-panel gs-player-detail-contract" open>
      <summary className="gs-players-kicker">
        <span>
          Contract History
          {careerTotal > 0 && (
            <span className="gs-player-detail-career-total">
              {' '}
              · career total: {fmtMoney(careerTotal)}
            </span>
          )}
        </span>
        <span className="gs-panel-toggle-icon" aria-hidden="true" />
      </summary>

      {contracts.map((c) => {
        const rows = c.yearDetails ?? [];
        const totalBase = rows.reduce((s, d) => s + (d.baseSalary ?? 0), 0);
        const totalSigning = rows.reduce((s, d) => s + (d.signingBonus ?? 0), 0);
        const totalRoster = rows.reduce((s, d) => s + (d.rosterBonus ?? 0), 0);
        const totalGuarSal = rows.reduce((s, d) => s + (d.guaranteedSalary ?? 0), 0);
        const totalCap = rows.reduce((s, d) => s + (d.capHit ?? 0), 0);
        const derivedCapPct =
          c.apyCapPct ??
          (rows.length > 0 ? rows.reduce((s, d) => s + (d.capPct ?? 0), 0) / rows.length : null);

        // Show dead money columns only for active contracts that have DM data
        const showDM = hasDeadMoney && !!c.isActive;

        const showFooter = !!c.otcUrl || showDM;

        return (
          <details
            key={c.id}
            open={c.isActive}
            className={`gs-player-detail-contract-block${c.isActive ? ' is-active' : ''}`}
          >
            <summary className="gs-player-detail-contract-header">
              <span className="gs-player-detail-contract-chevron" aria-hidden="true" />
              <span className="gs-player-detail-contract-meta">
                {c.teamAbbr ?? '—'}
                {c.yearSigned != null && ` · ${c.yearSigned}`}
                {c.years != null && ` · ${c.years}yr`}
                {c.totalValue != null && ` · ${fmtMoney(c.totalValue)}`}
              </span>
              {c.isActive && <span className="gs-player-detail-contract-active">Active</span>}
              {derivedCapPct != null && (
                <span className="gs-player-detail-contract-cappct">
                  {derivedCapPct.toFixed(1)}% cap
                </span>
              )}
            </summary>

            <div className="gs-player-detail-contract-content">
              {/* Aggregate summary */}
              <div className="gs-player-detail-contract-grid">
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">APY</div>
                  <div className="gs-player-detail-item-value">
                    {c.apy != null ? fmtMoney(c.apy) : '—'}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Total</div>
                  <div className="gs-player-detail-item-value">
                    {c.totalValue != null ? fmtMoney(c.totalValue) : '—'}
                  </div>
                </article>
                <article className="gs-player-detail-item">
                  <div className="gs-player-detail-item-label">Guaranteed</div>
                  <div className="gs-player-detail-item-value">
                    {c.guaranteed != null ? fmtMoney(c.guaranteed) : '—'}
                  </div>
                </article>
              </div>

              {rows.length > 0 && (
                <div className="gs-player-detail-cap-table-wrap">
                  <table className="gs-player-detail-cap-table">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Base</th>
                        <th>Signing</th>
                        <th>Roster</th>
                        <th>Guaranteed</th>
                        <th>Cap Hit</th>
                        <th>Cap %</th>
                        {showDM && <th className="gs-player-detail-dm-col">Dead $</th>}
                        {showDM && <th className="gs-player-detail-dm-col">Cap Sav.</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => {
                        const isFuture = d.year >= currentYear;
                        const dm = isFuture ? (d.deadMoney?.[scenario] ?? null) : null;
                        const cs = isFuture ? (d.capSavings?.[scenario] ?? null) : null;
                        const csNeg = cs != null && cs < 0;
                        return (
                          <tr key={d.year}>
                            <td>{d.year}</td>
                            <td>{d.baseSalary ? fmtMoney(d.baseSalary) : '—'}</td>
                            <td>{d.signingBonus ? fmtMoney(d.signingBonus) : '—'}</td>
                            <td>{d.rosterBonus ? fmtMoney(d.rosterBonus) : '—'}</td>
                            <td>{d.guaranteedSalary ? fmtMoney(d.guaranteedSalary) : '—'}</td>
                            <td className="gs-player-detail-cap-hit">
                              {d.capHit ? fmtMoney(d.capHit) : '—'}
                            </td>
                            <td className="gs-player-detail-cap-pct">
                              {d.capPct != null ? `${d.capPct.toFixed(1)}%` : '—'}
                            </td>
                            {showDM && (
                              <td className="gs-player-detail-dm-col">
                                {dm != null ? fmtMoney(Math.abs(dm)) : isFuture ? '$0' : '—'}
                              </td>
                            )}
                            {showDM && (
                              <td
                                className={`gs-player-detail-dm-col${csNeg ? ' gs-player-detail-dm-over' : cs != null && cs > 0 ? ' gs-player-detail-dm-under' : ''}`}
                              >
                                {cs != null
                                  ? csNeg
                                    ? `(${fmtMoney(Math.abs(cs))})`
                                    : fmtMoney(cs)
                                  : isFuture
                                    ? '$0'
                                    : '—'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="gs-player-detail-cap-totals">
                        <td>Total</td>
                        <td>{totalBase > 0 ? fmtMoney(totalBase) : '—'}</td>
                        <td>{totalSigning > 0 ? fmtMoney(totalSigning) : '—'}</td>
                        <td>{totalRoster > 0 ? fmtMoney(totalRoster) : '—'}</td>
                        <td>{totalGuarSal > 0 ? fmtMoney(totalGuarSal) : '—'}</td>
                        <td className="gs-player-detail-cap-hit">
                          {totalCap > 0 ? fmtMoney(totalCap) : '—'}
                        </td>
                        <td>—</td>
                        {showDM && <td className="gs-player-detail-dm-col">—</td>}
                        {showDM && <td className="gs-player-detail-dm-col">—</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {showFooter && (
                <div className="gs-player-detail-contract-footer">
                  {c.otcUrl ? (
                    <a
                      href={c.otcUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gs-player-detail-otc-link"
                    >
                      Full contract breakdown on OTC ↗
                    </a>
                  ) : (
                    <span />
                  )}
                  {showDM && (
                    <div className="gs-player-detail-scenario-inline">
                      <label
                        htmlFor="gs-scenario-select"
                        className="gs-player-detail-scenario-label"
                      >
                        Scenario
                      </label>
                      <select
                        id="gs-scenario-select"
                        value={scenario}
                        onChange={(e) => setScenario(e.target.value as Scenario)}
                        className="gs-player-detail-scenario-select"
                      >
                        {SCENARIO_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </details>
  );
}
