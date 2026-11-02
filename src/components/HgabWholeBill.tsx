/**
 * The overview's whole-bill section: every line of House Bill 10858 against the NEP, from
 * explorer/summary.json (scripts/hgab-lines/build_explorer.py). The rows are the leaderboards' own
 * (boards.json), so the overview, the explorer and the boards cannot disagree.
 */
import { Link } from 'react-router-dom';
import { SectionHead } from './shared';
import { KpiStrip } from './Nep2027Bits';
import { UnderReviewBanner } from './HgabExplorerBits';
import * as fmt from '../lib/format';
import { HGAB_ROOT } from '../lib/hgab';
import { EXPLORER_ROOT, fullPhp, type ExRankRow, type ExSummary } from '../lib/hgab-explorer';

/** "₱219.77B": two decimals, as on the leaderboards. */
function money(n: number): string {
  const a = Math.abs(n);
  return a >= 1e9 ? `₱${(a / 1e9).toFixed(2)}B` : `₱${fmt.shortPhp(a)}`;
}
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(n)}`;
const pctText = (p: number | null) => (p == null ? '' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`);
const board = (id: string) => `${HGAB_ROOT}/leaderboard/${id}`;

function Movers({ title, rows, boardId, added = false }: { title: string; rows: ExRankRow[]; boardId: string; added?: boolean }) {
  return (
    <div className="hgab-wb-movers">
      <h3>{title}</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.href + r.label}>
            <span className="hgab-wb-what">
              <Link to={r.href}>{r.label}</Link>
              <span className="hgab-wb-sub">{r.sub}</span>
              {r.note && <span className="hgab-wb-sub">{r.note}</span>}
            </span>
            <span className="hgab-wb-amt">
              <strong className={added || r.delta_php > 0 ? 'is-up' : 'is-down'} title={fullPhp(added ? r.hgab3_php : r.delta_php)}>
                {added ? money(r.hgab3_php) : signed(r.delta_php)}
              </strong>
              {!added && (
                <span className="hgab-wb-from" title={`NEP ${fullPhp(r.nep_php)} · House bill ${fullPhp(r.hgab3_php)}`}>
                  {money(r.nep_php)} → {money(r.hgab3_php)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <Link className="hgab-wb-more" to={board(boardId)}>The full board →</Link>
    </div>
  );
}

export default function HgabWholeBill({ s, projects }: {
  s: ExSummary;
  /** DPWH's insertion candidates (overview.json): the projects that moved inside its lines. */
  projects?: { count: number; php: number } | null;
}) {
  const st = s.lines.status;
  const d = s.departments;
  const r = s.readings;
  const readingChanges = r ? r.changed + r.relabel + r.added + r.removed : 0;
  const pct = (rows: ExRankRow[]) => rows.slice(0, 2).map((x) => `${x.label} ${pctText(x.delta_pct)}`).join(' and ');
  return (
    <section className="nep-section hgab-wb" aria-labelledby="hgab-wb-head">
      <SectionHead
        eyebrow="The whole House bill · line by line"
        headline={<span id="hgab-wb-head">{money(s.moved.raised_php)} raised in some lines and cut from others</span>}
        dek="Every line of the bill’s appropriation tables, beside the NEP line it matches. Without unprogrammed appropriations, the House bill’s total is the NEP’s, to the peso."
      />
      <UnderReviewBanner compact />
      <KpiStrip
        items={[
          {
            label: 'Same total',
            value: `₱${fmt.shortPhp(s.totals.house_bill_programmed_php, 'T')}`,
            sub: `NEP and House bill alike; the House bill adds ${money(s.totals.unprogrammed_php)} unprogrammed`,
          },
          { label: 'Raised or added', value: money(s.moved.raised_php), tone: 'up', sub: `and ${money(s.moved.cut_php)} cut or dropped elsewhere` },
          {
            label: 'Lines that differ',
            value: s.lines.differ.toLocaleString(),
            sub: `of ${s.lines.total.toLocaleString()}: ${(st.higher ?? 0).toLocaleString()} higher · ${(st.lower ?? 0).toLocaleString()} lower · ${(st.house_only ?? 0).toLocaleString()} House bill only · ${(st.nep_only ?? 0).toLocaleString()} NEP only`,
          },
          { label: 'Departments and funds', value: `${d.up} up · ${d.down} down`, sub: `${d.same} unchanged, of ${d.count}` },
        ]}
      />
      {projects && (
        <p className="hgab-wb-note">
          These figures are at the level the bill’s tables print. Inside the four programs below, projects moved too:
          DPWH alone has {projects.count.toLocaleString()} insertion candidates worth {money(projects.php)}.
        </p>
      )}
      <div className="hgab-wb-grid">
        <Movers title="Departments with the most added" rows={d.top_up} boardId="departments-increase" />
        <Movers title="Departments with the most cut" rows={d.top_down} boardId="departments-cuts" />
        <Movers title="Lines raised the most" rows={s.lines_up} boardId="lines-increase" />
        <Movers title="Lines cut the most" rows={s.lines_down} boardId="lines-cuts" />
      </div>
      <p className="hgab-wb-pct">
        As a share of their NEP budget (₱{(d.pct_floor_php / 1e9).toLocaleString()}B or more): {pct(d.top_up_pct)} rose the most;{' '}
        {pct(d.top_down_pct)} fell the most. <Link to={board('departments-increase-pct')}>Rises</Link> ·{' '}
        <Link to={board('departments-cuts-pct')}>cuts</Link>
      </p>
      <div className="hgab-wb-grid is-one">
        <Movers
          title={`${s.new_lines.count} lines the NEP does not have, worth ${money(s.new_lines.php)}`}
          rows={s.new_lines.top}
          boardId="lines-added"
          added
        />
      </div>
      <p className="nep-provenance">
        {r && <>The third reading changed {readingChanges} of {r.lines_3rd_reading.toLocaleString()} lines from the second. </>}
        New lines leave out the four programs below, which are compared project by project. Matches are by name:
        candidates, not findings. <Link to={EXPLORER_ROOT}>Every line, with its NEP and House bill pages</Link> ·{' '}
        <Link to={`${EXPLORER_ROOT}#downloads`}>download the data</Link>
      </p>
    </section>
  );
}
