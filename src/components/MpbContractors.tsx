/**
 * The multi-purpose buildings map's "Top contractors": the contractors holding the DPWH contracts matched to the
 * lines the page's controls select (and the district or place picked on the map), ranked by lines, budget amount or
 * contract amount. "Show their lines" narrows the map and the list to one contractor (`?contractor=`).
 *
 * Only FY2020–FY2026 lines can have a contract (contractors/mpb-links.json; src/lib/hgab-contractors.ts). A line
 * on a joint-venture contract counts for each partner, so lines and amounts are never added across contractors.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LINE_CONTRACTOR_SORTS, LINKED_YEARS, contractorPath, lineContractorsCsv, rankLineContractors,
  type LineContract, type LineContractorRow, type LineContractorSort,
} from '../lib/hgab-contractors';
import { billions, count, fullPeso } from '../lib/hgab-history-view';
import { officeShort, type MpbLine } from '../lib/hgab-mpb-years';

const PAGE = 20;

export default function MpbContractors({ lines, contracts, who, onPick }: {
  /** The lines the controls and the map pick select, before a contractor is picked. */
  lines: MpbLine[];
  contracts: ReadonlyMap<string, LineContract>;
  /** The picked contractor's key, or ''. */
  who: string;
  onPick: (key: string) => void;
}) {
  const [sort, setSort] = useState<LineContractorSort>('lines');
  const ranked = useMemo(() => rankLineContractors(lines, contracts, sort), [lines, contracts, sort]);
  const [more, setMore] = useState<{ of: LineContractorRow[]; n: number }>({ of: ranked.rows, n: PAGE });
  const shown = more.of === ranked.rows ? more.n : PAGE;
  const { rows, eligible, withContract } = ranked;
  const picked = who ? rows.findIndex((r) => r.key === who) : -1;
  // The picked contractor stays in view even when it ranks below the rows shown.
  const visible = picked >= shown ? [...rows.slice(0, shown), rows[picked]] : rows.slice(0, shown);
  const download = () => {
    const blob = new Blob(['﻿', lineContractorsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bettergov-multi-purpose-buildings-contractors.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const [from, to] = LINKED_YEARS;
  return (
    <section className="nep-section hgab-mpbm-section" id="hgab-mpbm-contractors" aria-labelledby="hgab-mpbm-contractors-h">
      <div className="hgab-mpbm-listhead">
        <div>
          <h2 id="hgab-mpbm-contractors-h" className="hgab-mpbm-h2">
            {eligible === 0 ? 'Top contractors'
              : `${count(rows.length)} ${rows.length === 1 ? 'contractor holds' : 'contractors hold'} the contracts for ${count(withContract)} of these ${count(eligible)} lines`}
          </h2>
          <p className="hgab-mpbm-dek">
            {eligible === 0
              ? <>Contracts are matched for the {from} to {to} budgets. Pick one of those years to rank their contractors.</>
              : <>
                  Lines from {from} to {to}, with the DPWH contract we matched by title, office and amount. A joint
                  venture’s line counts for each partner.
                </>}
          </p>
        </div>
        {rows.length > 0 && (
          <div className="hgab-mpbm-listactions">
            <label>
              <span>Rank by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as LineContractorSort)}>
                {(Object.keys(LINE_CONTRACTOR_SORTS) as LineContractorSort[]).map((k) => <option key={k} value={k}>{LINE_CONTRACTOR_SORTS[k]}</option>)}
              </select>
            </label>
            <button type="button" className="hgab-cta" onClick={download}>Download (CSV)</button>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="hgab-mpbm-tablewrap">
          <table className="hgab-mpbm-table hgab-mpbm-contractors">
            <thead>
              <tr>
                <th scope="col" className="is-num">#</th>
                <th scope="col">Contractor</th>
                <th scope="col" className="is-num">Lines</th>
                <th scope="col" className="is-num">Contracts</th>
                <th scope="col" className="is-num">Budget amount</th>
                <th scope="col" className="is-num">Contract amount</th>
                <th scope="col">Years</th>
                <th scope="col">Main DPWH office</th>
                <th scope="col"><span className="visually-hidden">Map</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const on = r.key === who;
                return (
                  <tr key={r.key} className={on ? 'is-picked' : undefined}>
                    <td className="is-num hgab-mpbm-rank">{rows.indexOf(r) + 1}</td>
                    <td>
                      <span className="hgab-mpbm-title"><Link to={contractorPath(r.key)}>{r.name}</Link></span>
                      {r.jvLines > 0 && <span className="hgab-mpbm-sub">{count(r.jvLines)} in joint ventures</span>}
                    </td>
                    <td className="is-num">{count(r.lines)}</td>
                    <td className="is-num">{count(r.contracts)}</td>
                    <td className="is-num">{amount(r.gaaPhp)}</td>
                    <td className="is-num">{amount(r.contractPhp)}</td>
                    <td className="hgab-mpbm-yr">{r.firstYear === r.lastYear ? r.firstYear : `${r.firstYear}–${r.lastYear}`}</td>
                    <td>
                      {officeShort(r.topOffice) ?? '—'}
                      {r.offices > 1 && <span className="hgab-mpbm-sub">{count(r.offices)} offices</span>}
                    </td>
                    <td>
                      <button type="button" className="hgab-mpbm-linkbtn" aria-pressed={on} onClick={() => onPick(on ? '' : r.key)}>
                        {on ? 'Show everyone' : 'Show their lines'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <p className="hgab-mpbm-more">
          Showing {count(shown)} of {count(rows.length)}.{' '}
          <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setMore({ of: rows, n: shown + PAGE * 5 })}>
            Show {count(Math.min(PAGE * 5, rows.length - shown))} more
          </button>
        </p>
      )}
      {eligible > 0 && rows.length === 0 && <p className="hgab-mpbm-more">None of these lines has a matched contract.</p>}
    </section>
  );
}

/** "₱1.2 billion", "₱45.0 million", "₱900,000". */
function amount(v: number): string {
  if (v >= 1e9) return billions(v);
  if (v >= 1e6) return `₱${(v / 1e6).toFixed(1)} million`;
  return fullPeso(Math.round(v));
}
