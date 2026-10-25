/**
 * Presentational pieces for the Districts pages (`/hgab/2027/districts`):
 * the tier badges, the representative block and portrait, the inline-SVG
 * budget history chart and its one-line key, the "appears on no card" panel,
 * the office chip and the district card itself. Components only (fast
 * refresh); every derived figure comes from `lib/hgab-districts.ts`.
 *
 * What these render is bound by the DEO2LEG conditions: every figure says
 * whose it is (its tier); shared (Tier B) money is shown as one whole-office
 * total beside the other districts it serves; the money no card shows is
 * published per year; the FY2027 groups keep the source's caution (leads for
 * checking, not findings); and nothing says a representative moved money.
 *
 * Wording is for a reader who has never opened a budget document. Technical
 * detail (matched labels, crosswalk ids, parquet paths) is not rendered here;
 * the detail page keeps it in a "Details for analysts" block.
 */
import { memo, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import {
  CONGRESS_TERMS, districtPath,
  type BridgeGroup, type CongressTerm, type DistrictCard, type DistrictRepresentative, type HgabDistrictIndex,
  type OfficeHistory, type ResidualYear,
} from '../lib/hgab';
import {
  ATTRIBUTION_LABELS, FISCAL_STAGE_LONG, FISCAL_STAGE_SCOPE, FISCAL_STAGE_SHORT, bridgeGroupTitle, cardFy27, cardOffices,
  cardRegionalGroups, coServedIds, congressBudgetYears, congressOf, congressOrdinal, congressPlain, districtLabel,
  districtRegionKey, fiscalYearRange, gaaSubtotal, headlineResidual, historySlots, officeParquetLabel,
  officeKindText, officeProjectsHref, officeTierBadgeText, officeTierText, regionNames, repName, residualMostlyOffCards,
  residualShare, residualUnattributed, residualWhere, slotLabel, type HistorySlot,
} from '../lib/hgab-districts';
import { HgabDetails, SignedPhp } from './HgabBits';
import '../hgab-districts.css';

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/** An office's tier. Tier B names how many other districts share it. */
export function TierBadge({ tier, sharedWith, compact = false }: { tier: 'A' | 'B'; sharedWith: number; compact?: boolean }) {
  const text = officeTierText(tier, sharedWith);
  return (
    <span className={`hgab-tier is-${tier} ${compact ? 'is-compact' : ''}`.trim()} title={tier === 'A'
      ? 'This office serves only this district, so its figures can be read as the district’s.'
      : `This office serves ${sharedWith + 1} districts. Its figures are the whole office’s and are not split between them.`}>
      <span aria-hidden="true">{tier === 'A' ? 'Tier A' : 'Tier B'}</span>
      <small aria-hidden="true">{officeTierBadgeText(tier, sharedWith)}</small>
      <span className="visually-hidden">{text}</span>
    </span>
  );
}

/** A card's overall answer to "Whose budget is this?": Tier A, Tier B, mixed, or no office. */
export function AttributionBadge({ attribution }: { attribution: DistrictCard['attribution'] }) {
  const a = ATTRIBUTION_LABELS[attribution];
  return (
    <span className={`hgab-tier is-${attribution}`} title={a.help}>
      {a.short}
      <small>{a.badge}</small>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Representative
// ---------------------------------------------------------------------------

/**
 * The seat holder's portrait from bills.juris.ph (Commons-mirrored, attributed).
 * A null URL or a failed load shows a neutral placeholder, never a broken image.
 *
 * The failure path flips a class on the frame instead of setting React state:
 * on a grid of 250 cards a blocked image host (the portal is served with
 * COEP require-corp) fires hundreds of error events, and each urgent state
 * update would interrupt and restart the router's transition render of the
 * grid, making every filter change lag. A class toggle costs nothing.
 */
export function Portrait({ rep, large = false }: { rep: DistrictRepresentative | null; large?: boolean }) {
  const name = repName(rep);
  const cls = `hgab-portrait ${large ? 'is-large' : ''}`.trim();
  const placeholder = (
    <span className={`${cls} hgab-portrait-empty`} role="img" aria-label={`${name}: no portrait`}>no portrait</span>
  );
  if (!rep?.portrait_url) return placeholder;
  return (
    <span className="hgab-portrait-frame">
      <img
        className={cls}
        src={rep.portrait_url}
        alt={name}
        loading="lazy"
        width={large ? 132 : 72}
        height={large ? 176 : 96}
        onError={(e) => e.currentTarget.parentElement?.classList.add('is-broken')}
      />
      {placeholder}
    </span>
  );
}

/** Credit and licence of the portrait, as the roster publishes them. */
export function PortraitCredit({ rep }: { rep: DistrictRepresentative | null }) {
  if (!rep?.portrait_url) return null;
  const parts = [rep.portrait_attribution, rep.portrait_license].filter(Boolean).join(' · ');
  if (!parts && !rep.portrait_source_url) return null;
  return (
    <p className="hgab-portrait-credit">
      Portrait: {parts || 'as published'}
      {rep.portrait_source_url && (
        <> · <a href={rep.portrait_source_url} target="_blank" rel="noopener noreferrer">source ↗</a></>
      )}
    </p>
  );
}

/**
 * Name, seat, leadership roles and links for the holder of a seat in the 20th
 * Congress. A seat with two members listed shows both side by side and picks
 * neither. Nothing here attributes a project or an amount to the person.
 */
export function RepresentativeBlock({ rep, large = false, showProfile = false }: {
  rep: DistrictRepresentative | null;
  large?: boolean;
  showProfile?: boolean;
}) {
  if (!rep) return <p className="hgab-dc-rep is-empty">No representative found in the roster.</p>;
  if (rep.status === 'ambiguous') {
    const cands = rep.candidates ?? [];
    return (
      <div className="hgab-dc-ambiguous">
        <p className="hgab-dc-ambiguous-note" title="congress.gov.ph lists more than one member for this seat. This page picks neither.">
          {cands.length === 2 ? 'Two members listed; neither chosen' : `${cands.length || 'Several'} members listed; none chosen`}
        </p>
        {cands.length > 0 ? (
          <div className="hgab-dc-ambiguous-grid">
            {cands.map((c) => (
              <div key={`${c.member_code ?? ''}:${c.name}`}>
                <Portrait rep={c} />
                <RepresentativeBlock rep={{ ...c, status: 'resolved', candidates: undefined }} large={large} showProfile={showProfile} />
              </div>
            ))}
          </div>
        ) : (
          <p className="hgab-dc-seat">{rep.seat}</p>
        )}
      </div>
    );
  }
  const bills = rep.bill_count != null && rep.juris_url;
  return (
    <div className="hgab-dc-repblock">
      <p className="hgab-dc-rep">{rep.name}</p>
      <p className="hgab-dc-seat">{rep.seat}{large ? ' · 20th Congress' : ''}</p>
      {rep.leadership_roles.length > 0 && (
        <p className="hgab-dc-roles" aria-label="Leadership roles">
          {rep.leadership_roles.map((r) => <span key={r}>{r}</span>)}
        </p>
      )}
      {(bills || (showProfile && (rep.profile_url || rep.juris_url))) && (
        <p className="hgab-dc-links">
          {bills && (
            <a href={rep.juris_url!} target="_blank" rel="noopener noreferrer" title="Bills this member authored, on bills.juris.ph">
              Bills: {rep.bill_count!.toLocaleString()} ↗
            </a>
          )}
          {showProfile && rep.juris_url && !bills && (
            <a href={rep.juris_url} target="_blank" rel="noopener noreferrer">bills.juris.ph ↗</a>
          )}
          {showProfile && rep.profile_url && (
            <a href={rep.profile_url} target="_blank" rel="noopener noreferrer" title="Official roster entry">congress.gov.ph ↗</a>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History chart
// ---------------------------------------------------------------------------

function slotTitle(s: HistorySlot): string {
  const head = `${slotLabel(s)} · ${s.congress.label}`;
  if (s.php == null) return `${head} · not found in that year’s data, not zero`;
  return `${head} · ${fmt.php(s.php, { unit: 'full' })} · ${FISCAL_STAGE_SCOPE[s.stage]}`;
}

/** Tick under each bar: ’20…’26, then "proposal" and "House bill" (card) or "2027 proposal" / "2027 House bill" (full). */
function fyTick(s: HistorySlot, full: boolean): string {
  if (s.fy === 2027) {
    if (full) return s.stage === 'nep' ? '2027 proposal' : '2027 House bill';
    return s.stage === 'nep' ? 'proposal' : 'House bill';
  }
  return full ? String(s.fy) : `’${String(s.fy).slice(2)}`;
}

/**
 * One office's budget across the nine slots — FY2020–2026 enacted (solid),
 * FY2027 proposal (hatched) and FY2027 House bill (House accent) — grouped
 * under the Congress that handled each year, with that Congress's enacted
 * subtotal printed. A null year is a dashed empty slot, never a zero bar. Pure
 * inline SVG; the `<title>` on every slot and the aria-label carry the exact
 * figures.
 *
 * `max` lets a card with several offices draw every row on one scale; by
 * default the chart scales to its own largest figure.
 */
export function HistoryChart({ office, max, size = 'card', showValues = size === 'full' }: {
  office: OfficeHistory;
  max?: number;
  size?: 'card' | 'full';
  showValues?: boolean;
}) {
  const hatchId = `hgab-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const full = size === 'full';
  const slots = historySlots(office);
  const W = full ? 760 : 360;
  const H = full ? 260 : 132;
  const top = (full ? 42 : 30) + (showValues ? (full ? 14 : 11) : 0);
  // Two tick lines: years and "proposal" on the upper one, "House bill" on the
  // lower, so the two 2027 labels never overlap at card width.
  const bottom = full ? 32 : 24;
  const groupGap = full ? 18 : 10;
  const slotW = (W - 2 * groupGap) / 9;
  const barW = slotW * (full ? 0.56 : 0.62);
  const plotBottom = H - bottom;
  const plotH = plotBottom - top;
  const scale = Math.max(max ?? 0, ...slots.map((s) => s.php ?? 0)) || 1;

  const summary = `${office.name}: ${slots.map((s) => `${slotLabel(s)} ${s.php == null ? 'no data' : fmt.php(s.php)}`).join(', ')}.`;

  return (
    <svg className={`hgab-hc is-${size}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} focusable="false">
      <defs>
        <pattern id={hatchId} className="hgab-hc-hatch" patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M0 4 L4 0 M-1 1 L1 -1 M3 5 L5 3" />
        </pattern>
      </defs>
      {CONGRESS_TERMS.map((term, gi) => {
        const x0 = gi * (3 * slotW + groupGap);
        const sub = gaaSubtotal(office, term.congress);
        const subText = sub.php == null ? (full ? 'no enacted figure' : '—') : full ? `Enacted ${fmt.shortPhp(sub.php)}` : `${fmt.shortPhp(sub.php)} enacted`;
        const yearsText = full && sub.years.length ? ` (${fiscalYearRange(sub.years).replace('FY', '')})` : '';
        return (
          <g key={term.congress}>
            {term.congress === 20 && <rect className="hgab-hc-band" x={x0} y={0} width={3 * slotW} height={plotBottom} />}
            {gi > 0 && <line className="hgab-hc-sep" x1={x0 - groupGap / 2} x2={x0 - groupGap / 2} y1={4} y2={plotBottom} />}
            <text className="hgab-hc-term" x={x0 + 3} y={full ? 13 : 10}>{full ? term.label : `${term.congress}th`}</text>
            <text className="hgab-hc-term-sub" x={x0 + 3} y={full ? 29 : 22}>
              <title>{`${term.label}: ${sub.php == null ? 'no enacted figure found' : `${fmt.php(sub.php, { unit: 'full' })} enacted across ${fiscalYearRange(sub.years).replace('FY', '')}`}. The 2027 proposal and House bill are listed, not added.`}</title>
              {subText}{yearsText}
            </text>
          </g>
        );
      })}
      <line className="hgab-hc-axis" x1={0} x2={W} y1={plotBottom} y2={plotBottom} />
      {slots.map((s, i) => {
        const gi = Math.floor(i / 3);
        const x = gi * (3 * slotW + groupGap) + (i % 3) * slotW + (slotW - barW) / 2;
        const cx = x + barW / 2;
        let body: ReactNode;
        if (s.php == null) {
          const h = plotH * 0.28;
          body = <rect className="hgab-hc-empty" x={x} y={plotBottom - h} width={barW} height={h} rx={1} />;
        } else if (s.php === 0) {
          body = <line className="hgab-hc-zero" x1={x} x2={x + barW} y1={plotBottom - 1} y2={plotBottom - 1} />;
        } else {
          const h = Math.max((s.php / scale) * plotH, 1.5);
          body = (
            <rect
              className={`hgab-hc-bar is-${s.stage}`}
              x={x}
              y={plotBottom - h}
              width={barW}
              height={h}
              fill={s.stage === 'nep' ? `url(#${hatchId})` : undefined}
            />
          );
        }
        const valueY = s.php == null ? null : plotBottom - Math.max((s.php / scale) * plotH, 1.5) - 4;
        // On the proposal slot, a tick marks the proposal for the same named
        // projects — the figure the House bill is actually compared with.
        const comparedNep = s.stage === 'nep' ? office.fy2027?.nep_php ?? null : null;
        return (
          <g key={`${s.fy}-${s.stage}`}>
            <title>{slotTitle(s)}</title>
            {body}
            {comparedNep != null && comparedNep > 0 && (
              <g>
                <title>{`2027 proposal, same named projects as the House bill: ${fmt.php(comparedNep, { unit: 'full' })}. This is the figure the House bill is compared with.`}</title>
                <line className="hgab-hc-mark" x1={x - 2} x2={x + barW + 2} y1={plotBottom - (comparedNep / scale) * plotH} y2={plotBottom - (comparedNep / scale) * plotH} />
              </g>
            )}
            {showValues && s.php != null && valueY != null && (
              <text className="hgab-hc-val" x={cx} y={valueY}>{fmt.shortPhp(s.php)}</text>
            )}
            <text className="hgab-hc-fy" x={cx} y={s.stage === 'hgab3' ? H - 3 : H - (full ? 17 : 13)}>{fyTick(s, full)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Full wording on desktop, a shorter one on a phone; only the visible one is read out. */
function KeyText({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="hgab-keyrow-long">{long}</span>
      <span className="hgab-keyrow-short">{short}</span>
    </>
  );
}

/**
 * The one-line key every page with a history chart carries once: which
 * budget years each Congress handled, the four bar styles, and a "How to read
 * the chart" disclosure with the rest in three short sentences.
 */
export function ChartKeyRow({ terms = CONGRESS_TERMS }: { terms?: readonly CongressTerm[] }) {
  return (
    <div className="hgab-keyrow" role="group" aria-label="Chart key">
      <ol className="hgab-keyrow-terms" aria-label="Budget years each Congress handled">
        {terms.map((t, i) => (
          <li key={t.congress} className={t.congress === 20 ? 'is-current' : undefined} title={`${t.label} ${congressPlain(t)}`}>
            <span className="hgab-keyrow-long"><strong>{i === 0 ? t.label : congressOrdinal(t)}</strong> · {congressBudgetYears(t)}</span>
            <span className="hgab-keyrow-short"><strong>{congressOrdinal(t)}</strong> {congressBudgetYears(t, true)}</span>
          </li>
        ))}
      </ol>
      <ul className="hgab-keyrow-bars" aria-label="Bar styles">
        <li title={FISCAL_STAGE_LONG.gaa}><i className="is-gaa" aria-hidden="true" /><KeyText long="enacted budget" short="enacted" /></li>
        <li title={FISCAL_STAGE_LONG.nep}><i className="is-nep" aria-hidden="true" /><KeyText long="2027 proposal" short="proposal" /></li>
        <li title={FISCAL_STAGE_LONG.hgab3}><i className="is-hgab3" aria-hidden="true" /><KeyText long="2027 House bill" short="House bill" /></li>
        <li title="The office was not found in that year’s data. This never means zero.">
          <i className="is-empty" aria-hidden="true" /><KeyText long="office not found that year" short="not found" />
        </li>
      </ul>
      <details className="hgab-keyrow-help">
        <summary><KeyText long="How to read the chart" short="How to read" /></summary>
        <div className="hgab-keyrow-pop">
          <p>
            Bars are grouped by the Congress that handled each budget; the figure above is its enacted
            total, without 2027.
          </p>
          <p>
            The House bill bar counts named projects only; the thin line on the proposal bar marks those
            same projects.
          </p>
          <p>A dashed outline means the office was not found in that year’s data, never that it got zero.</p>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The money that appears on no district card (condition 3)
// ---------------------------------------------------------------------------

const RESIDUAL_SEGMENTS: ReadonlyArray<{ key: 'deo' | 'central' | 'regional' | 'unmatched'; label: string; pick: (y: ResidualYear) => number }> = [
  { key: 'deo', label: 'On district cards', pick: (y) => y.deo_php },
  { key: 'central', label: 'Central Office', pick: (y) => y.central_office_php },
  { key: 'regional', label: 'Regional offices', pick: (y) => y.regional_offices_php },
  { key: 'unmatched', label: 'Offices we could not place', pick: (y) => y.unmatched_php },
];

/**
 * The money no district card shows, every year: a stacked bar per fiscal year
 * with exact pesos on hover and in the expandable table. Shown before the
 * cards so the grid cannot imply full coverage.
 */
export function ResidualPanel({ residual, scopeNotes }: { residual: readonly ResidualYear[]; scopeNotes?: readonly string[] }) {
  const head = headlineResidual(residual);
  const share = head ? residualShare(head) : null;
  const unmatched = [...new Set(residual.flatMap((y) => y.unmatched_labels ?? []))];
  return (
    <section className="hgab-res" aria-labelledby="hgab-res-title">
      <p className="hgab-res-eyebrow">Money not assigned to a district · shown every year</p>
      <h2 id="hgab-res-title">
        {head
          ? <>{fmt.php(residualUnattributed(head))} of {fmt.php(head.total_php)} in the {slotLabel(head)} is listed under {residualWhere(head)}, so it appears on no district card.</>
          : 'Money under the DPWH Central Office and regional offices appears on no district card.'}
      </h2>
      {head && share != null && (
        <p className="hgab-res-lede">
          That is <strong>{fmt.pct(share, 1)}</strong> of the total. The Central Office holds{' '}
          <strong>{fmt.php(head.central_office_php)}</strong> and regional offices <strong>{fmt.php(head.regional_offices_php)}</strong>.
          {head.unmatched_php > 0 && <> Another <strong>{fmt.php(head.unmatched_php)}</strong> sits under offices we could not place on our office-to-district map.</>}
          {' '}The district cards below carry the remaining <strong>{fmt.php(head.deo_php)}</strong> ({fmt.pct(1 - share, 1)}).
          {residualMostlyOffCards(residual) && ' In every year shown, most DPWH money is not assigned to a district.'}
        </p>
      )}
      <ul className="hgab-res-legend">
        {RESIDUAL_SEGMENTS.map((s) => (
          <li key={s.key}><span className={`hgab-res-swatch is-${s.key}`} aria-hidden="true" />{s.label}</li>
        ))}
      </ul>
      <ul className="hgab-res-rows" aria-label="Money not assigned to a district, by year">
        {residual.map((y) => {
          const total = y.total_php || 1;
          const off = residualShare(y);
          const isHead = head != null && y.fy === head.fy && y.stage === head.stage;
          const title = RESIDUAL_SEGMENTS.map((s) => `${s.label} ${fmt.php(s.pick(y), { unit: 'full' })}`).join(' · ');
          return (
            <li key={`${y.fy}-${y.stage}`} className={`hgab-res-row ${y.stage !== 'gaa' ? 'is-proposal' : ''} ${isHead ? 'is-headline' : ''}`.trim()}>
              <span className="hgab-res-year">
                {slotLabel(y)}
                <small>{congressOf(y.fy)?.label ?? ''}</small>
              </span>
              <span className="hgab-res-bar" role="img" aria-label={`${slotLabel(y)}: ${title}`} title={`Total ${fmt.php(y.total_php, { unit: 'full' })}`}>
                {RESIDUAL_SEGMENTS.map((s) => {
                  const v = s.pick(y);
                  if (v <= 0) return null;
                  return (
                    <span
                      key={s.key}
                      className={`hgab-res-seg is-${s.key}`}
                      style={{ width: `${(v / total) * 100}%` }}
                      title={`${s.label} · ${fmt.php(v, { unit: 'full' })} · ${fmt.pct(v / total, 1)} of the ${slotLabel(y)}`}
                    />
                  );
                })}
              </span>
              <span className="hgab-res-share">
                <strong>{off == null ? '—' : fmt.pct(off, 1)}</strong> on no card
                <small>of {fmt.php(y.total_php)} in total · {fmt.php(y.deo_php)} on cards</small>
              </span>
            </li>
          );
        })}
      </ul>
      <details className="hgab-res-exact">
        <summary>Exact pesos, every year</summary>
        <div className="nep-table-wrap">
          <table className="nep-table">
            <thead>
              <tr>
                <th className="nep-th-name">Year and document</th>
                <th className="num">Total</th>
                <th className="num">On district cards</th>
                <th className="num">Central Office</th>
                <th className="num">Regional offices</th>
                <th className="num">Could not place</th>
                <th className="num">On no card</th>
              </tr>
            </thead>
            <tbody>
              {residual.map((y) => {
                const off = residualShare(y);
                return (
                  <tr key={`${y.fy}-${y.stage}`}>
                    <td className="nep-td-name">
                      {slotLabel(y)}
                      <span className="nep-code">{FISCAL_STAGE_SHORT[y.stage]} · {congressOf(y.fy)?.label}</span>
                    </td>
                    <td className="num">{fmt.php(y.total_php, { unit: 'full' })}</td>
                    <td className="num">{fmt.php(y.deo_php, { unit: 'full' })}</td>
                    <td className="num">{fmt.php(y.central_office_php, { unit: 'full' })}</td>
                    <td className="num">{fmt.php(y.regional_offices_php, { unit: 'full' })}</td>
                    <td className="num">{fmt.php(y.unmatched_php, { unit: 'full' })}</td>
                    <td className="num">{fmt.php(residualUnattributed(y), { unit: 'full' })}{off != null && ` (${fmt.pct(off, 1)})`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unmatched.length > 0 && (
          <p className="hgab-res-unmatched">
            Offices we could not place: office names printed in a year’s budget that match no office on our
            office-to-district map. Their money is counted here and assigned to no district. They are:{' '}
            {unmatched.join('; ')}.
          </p>
        )}
      </details>
      {scopeNotes && scopeNotes.length > 0 && (
        <HgabDetails title="Details for analysts: what each figure covers" className="hgab-res-notes">
          <ul>
            {scopeNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </HgabDetails>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The seat-holder caveat
// ---------------------------------------------------------------------------

/** The one sentence every page carries about who is shown and what that does not mean. */
export function CongressCaveat() {
  return (
    <p className="hgab-congress-caveat">
      <strong>The representative shown holds the seat in the 20th Congress.</strong> The 2020–2025 budgets
      were passed by the 18th and 19th Congresses, whose members are not shown. Nothing on this page
      says or implies that a representative requested, sponsored or controlled a project.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Office pieces
// ---------------------------------------------------------------------------

/** An office name with its tier badge; Tier B chips say how many districts share it. */
export function OfficeChip({ office, to }: { office: OfficeHistory; to?: string }) {
  return (
    <span className="hgab-dc-office" title={`${officeKindText(office)}${office.region ? ` · ${office.region}` : ''}`}>
      <TierBadge tier={office.tier} sharedWith={Math.max(0, office.district_ids.length - 1)} compact />
      {to ? <Link to={to}>{office.name}</Link> : office.name}
    </span>
  );
}

/** Links to the other districts an office serves, separated by semicolons because each label has a comma. */
export function CoServedLinks({ ids, index }: { ids: readonly string[]; index: HgabDistrictIndex }) {
  if (!ids.length) return null;
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && '; '}
          <Link to={districtPath(id)}>{districtLabel(index, id)}</Link>
        </span>
      ))}
    </>
  );
}

/** Short, plain name of each group in the one-line 2027 summary; the tooltip carries the full meaning. */
const GROUP_PHRASE: Record<BridgeGroup, (rows: number) => string> = {
  house_only: (n) => `${n === 1 ? 'project' : 'projects'} not in the proposal`,
  nep_only: () => 'in the proposal only',
  unchanged: () => 'same amount in both',
  increased: () => 'raised',
  decreased: () => 'cut',
  scope_review: () => 'a different stretch of the same road',
};

function BridgeCellText({ group, cell, sign }: { group: BridgeGroup; cell: { rows: number; php: number }; sign: string }) {
  return (
    <span className={`hgab-dc-bridge-cell is-${group}`} title={bridgeGroupTitle(group)}>
      <strong>{cell.rows.toLocaleString()}</strong> {GROUP_PHRASE[group](cell.rows)}
      {cell.rows > 0 && <> ({sign}{fmt.shortPhp(Math.abs(cell.php))})</>}
    </span>
  );
}

/**
 * One line: how the House bill differs from the proposal for an office's
 * projects. "Not in the proposal" and "in the proposal only" are leads for
 * checking, not findings; uncertain matches are left out upstream.
 */
export function OfficeBridgeLine({ office, withName = false }: { office: OfficeHistory; withName?: boolean }) {
  const b = office.fy2027?.bridge ?? null;
  if (!b) {
    return (
      <p className="hgab-dc-bridge">
        <em>In the House bill{withName ? ` · ${office.name}` : ''}:</em>{' '}no 2027 project comparison for this office.
      </p>
    );
  }
  return (
    <p className="hgab-dc-bridge">
      <em>In the House bill{withName ? ` · ${office.name}` : ''}:</em>{' '}
      <BridgeCellText group="house_only" cell={b.house_only} sign="+" />{' · '}
      <BridgeCellText group="nep_only" cell={b.nep_only} sign="−" />{' · '}
      <BridgeCellText group="increased" cell={b.increased} sign="+" />{' · '}
      <BridgeCellText group="decreased" cell={b.decreased} sign="−" />
      {b.scope_review.rows > 0 && <>{' · '}<BridgeCellText group="scope_review" cell={b.scope_review} sign="±" /></>}
      {' · '}
      <span className="hgab-dc-bridge-net" title="House bill total minus proposal total, for the same named projects">net <SignedPhp value={b.net_php} /></span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function Figure({ v }: { v: number | null }) {
  if (v == null) return <span className="hgab-amt is-empty" title="No figure in this document">—</span>;
  return <span className="hgab-amt" title={fmt.php(v, { unit: 'full' })}>{fmt.shortPhp(v)}</span>;
}

/**
 * One legislative district: who holds the seat, which office(s) serve it, the
 * office history by Congress, the headline figures (labelled shared when the
 * office is), the one-line 2027 summary, and the links out. Memoised: the grid
 * draws 250 of these, each with an SVG, and typing in the search box must not
 * redraw them.
 */
export const DistrictCardView = memo(function DistrictCardView({ card, index, level = 3 }: {
  card: DistrictCard;
  index: HgabDistrictIndex;
  /** 4 under a region heading (h3), 3 in the flat list. */
  level?: 3 | 4;
}) {
  const offices = cardOffices(card, index);
  const groups = cardRegionalGroups(card, index);
  const rep = card.representative;
  const ambiguous = rep?.status === 'ambiguous';
  const undivided = card.attribution === 'B' || card.attribution === 'mixed';
  const coServed = coServedIds(card, index);
  const max = Math.max(0, ...offices.flatMap((o) => historySlots(o).map((s) => s.php ?? 0)));
  const h = card.headline;
  const fy27 = cardFy27(card, index);
  const hid = `hgab-dc-${card.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const Heading = level === 4 ? 'h4' : 'h3';
  const regionKey = districtRegionKey(card);

  return (
    <article className="hgab-dc" data-attribution={card.attribution} aria-labelledby={hid}>
      <header className="hgab-dc-head">
        {!ambiguous && <Portrait rep={rep} />}
        <div className="hgab-dc-title">
          <p className="hgab-dc-eyebrow">
            <span title={card.region ?? undefined}>{regionKey === 'other' ? card.region ?? 'Region not recorded' : regionNames(regionKey).name}</span>
            <AttributionBadge attribution={card.attribution} />
          </p>
          <Heading className="hgab-dc-district" id={hid}>
            <Link to={districtPath(card.id)}>{card.label}</Link>
          </Heading>
          <RepresentativeBlock rep={rep} />
        </div>
      </header>

      <ul className="hgab-dc-offices" aria-label="District engineering offices serving this district">
        {offices.map((o) => <li key={o.id}><OfficeChip office={o} /></li>)}
        {groups.map((g) => (
          <li key={g.id} className="hgab-dc-nooffice">
            {g.name} is a regional grouping, not a district office. Its money is not assigned to a district and appears on no card.
          </li>
        ))}
        {offices.length === 0 && groups.length === 0 && <li className="hgab-dc-nooffice">{ATTRIBUTION_LABELS.none.help}</li>}
      </ul>

      {offices.map((o, i) => (
        <div className="hgab-dc-chartrow" key={o.id}>
          <div className="hgab-dc-chartrow-head">
            <span title={o.name}>{o.name}{offices.length > 1 ? ` · office ${i + 1} of ${offices.length}` : ''}</span>
            <TierBadge tier={o.tier} sharedWith={Math.max(0, o.district_ids.length - 1)} compact />
          </div>
          <HistoryChart office={o} max={max || undefined} />
        </div>
      ))}

      {offices.length > 0 && (
        <div>
          <dl className="hgab-dc-figures">
            <div><dt title={`${FISCAL_STAGE_LONG.gaa} Whole office.`}>2026 enacted</dt><dd><Figure v={h.fy2026_gaa_php} /></dd></div>
            <div>
              <dt title={`${FISCAL_STAGE_LONG.nep} Whole office; not the figure the change below is measured from.`}>2027 proposal</dt>
              <dd><Figure v={h.fy2027_nep_php} /></dd>
            </div>
            <div>
              <dt title={`${FISCAL_STAGE_LONG.hgab3} Named projects only.`}>2027 House bill</dt>
              <dd>
                <Figure v={h.fy2027_hgab3_php} />
                {fy27.delta_php != null && (
                  <span
                    className="hgab-delta-line"
                    title={`House bill (third reading) against the President’s proposal, same named projects: proposal ${fmt.php(fy27.nep_php, { unit: 'full' })} → House bill ${fmt.php(fy27.hgab3_php, { unit: 'full' })}`}
                  >
                    <SignedPhp value={fy27.delta_php} /> <span className="hgab-delta">vs the proposal, same projects</span>
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {undivided && (
            <p className="hgab-dc-undivided">
              Shared office total, not split · also serves <CoServedLinks ids={coServed} index={index} />
            </p>
          )}
          {!undivided && offices.length > 1 && (
            <p className="hgab-dc-undivided is-sum">Total of {offices.length} offices</p>
          )}
        </div>
      )}

      {offices.map((o) => <OfficeBridgeLine key={o.id} office={o} withName={offices.length > 1} />)}

      <footer className="hgab-card-ctas">
        <Link className="hgab-cta hgab-cta-primary" to={districtPath(card.id)}>Open district →</Link>
        {offices.map((o) => (
          <Link key={o.id} className="hgab-cta" to={officeProjectsHref(o)} title={`Every DPWH project recorded under ${officeParquetLabel(o)}`}>
            Projects{offices.length > 1 ? ` · ${o.name}` : ''}
          </Link>
        ))}
        {!ambiguous && rep?.juris_url && (
          <a className="hgab-cta hgab-cta-quiet" href={rep.juris_url} target="_blank" rel="noopener noreferrer">bills.juris.ph ↗</a>
        )}
      </footer>
    </article>
  );
});
