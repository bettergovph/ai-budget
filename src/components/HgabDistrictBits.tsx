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
 * An office is always shown beside the legislative district it serves, as a
 * small badge after the district's name ("Davao de Oro, 2nd District · 1st
 * DEO", DeoBadges): a DEO's number is its own.
 *
 * Wording is for a reader who has never opened a budget document. Technical
 * detail (matched labels, crosswalk ids, parquet paths) is not rendered here;
 * the detail page keeps it in a "Details for analysts" block.
 */
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import {
  CONGRESS_TERMS, districtPath,
  type BridgeGroup, type CongressTerm, type DistrictCard, type DistrictRepresentative, type HgabDistrictIndex,
  type OfficeHistory, type ResidualYear,
} from '../lib/hgab';
import {
  ATTRIBUTION_LABELS, FISCAL_STAGE_LONG, FISCAL_STAGE_SCOPE, FISCAL_STAGE_SHORT, bridgeGroupTitle, cardFy27, cardOffices,
  cardRegionalGroups, coServedIds, congressBudgetYears, congressOf, congressOrdinal, congressPlain, districtAnchor,
  districtLabel, districtRegionKey, dpwhOfficeName, fiscalYearRange, gaaSubtotal, headlineResidual, historySlots, officeParquetLabel,
  officeProjectsHref, officeTierBadgeText, officeTierText, regionNames, repName, residualMostlyOffCards,
  residualNoOffice, residualOfficeChange, residualShare, residualUnattributed, slotLabel, type HistorySlot,
} from '../lib/hgab-districts';
import { DeoBadges, HgabDetails, SignedPhp } from './HgabBits';
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
            <a href={rep.juris_url} target="_blank" rel="noopener noreferrer" title="Bills and profile on bills.juris.ph">More Info ↗</a>
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

/** Tick under each bar: ’20…’26, then "NEP" and "House bill" (card) or "2027 NEP" / "2027 House bill" (full). */
function fyTick(s: HistorySlot, full: boolean): string {
  if (s.fy === 2027) {
    if (full) return s.stage === 'nep' ? '2027 NEP' : '2027 House bill';
    return s.stage === 'nep' ? 'NEP' : 'House bill';
  }
  return full ? String(s.fy) : `’${String(s.fy).slice(2)}`;
}

/**
 * One office's budget across the nine slots — FY2020–2026 enacted (solid),
 * FY2027 NEP (hatched) and FY2027 House bill (House accent) — grouped
 * under the Congress that handled each year, with that Congress's enacted
 * subtotal shown. A null year is a dashed empty slot, never a zero bar. Pure
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
  // Two tick lines: years and "NEP" on the upper one, "House bill" on the
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
              <title>{`${term.label}: ${sub.php == null ? 'no enacted figure found' : `${fmt.php(sub.php, { unit: 'full' })} enacted across ${fiscalYearRange(sub.years).replace('FY', '')}`}. The 2027 NEP and House bill are listed, not added.`}</title>
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
        // On the NEP slot, a tick marks the NEP for the same named
        // projects — the figure the House bill is actually compared with.
        const comparedNep = s.stage === 'nep' ? office.fy2027?.nep_php ?? null : null;
        return (
          <g key={`${s.fy}-${s.stage}`}>
            <title>{slotTitle(s)}</title>
            {body}
            {comparedNep != null && comparedNep > 0 && (
              <g>
                <title>{`2027 NEP, same named projects as the House bill: ${fmt.php(comparedNep, { unit: 'full' })}. This is the figure the House bill is compared with.`}</title>
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
        <li title={FISCAL_STAGE_LONG.nep}><i className="is-nep" aria-hidden="true" /><KeyText long="2027 NEP" short="NEP" /></li>
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
            The House bill bar counts named projects only; the thin line on the NEP bar marks those
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

const RESIDUAL_SEGMENTS: ReadonlyArray<{
  key: 'deo' | 'central' | 'regional' | 'unmatched' | 'no_office' | 'office_change';
  label: string;
  pick: (y: ResidualYear) => number;
}> = [
  { key: 'deo', label: 'On district cards', pick: (y) => y.deo_php },
  { key: 'central', label: 'Central Office', pick: (y) => y.central_office_php },
  { key: 'regional', label: 'Regional offices', pick: (y) => y.regional_offices_php },
  { key: 'unmatched', label: 'Offices we could not place', pick: (y) => y.unmatched_php },
  { key: 'no_office', label: 'Lines with no office', pick: (y) => residualNoOffice(y) },
  { key: 'office_change', label: 'Lines that changed office', pick: (y) => residualOfficeChange(y) },
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
          ? <>{fmt.php(residualUnattributed(head))} of {fmt.php(head.total_php)} in the {slotLabel(head)} appears on no district card.</>
          : 'Money under the DPWH Central Office and regional offices appears on no district card.'}
      </h2>
      {head && share != null && (
        <p className="hgab-res-lede">
          That is <strong>{fmt.pct(share, 1)}</strong> of the total. The Central Office holds{' '}
          <strong>{fmt.php(head.central_office_php)}</strong> and regional offices <strong>{fmt.php(head.regional_offices_php)}</strong>.
          {head.unmatched_php > 0 && <> Another <strong>{fmt.php(head.unmatched_php)}</strong> sits under offices we could not place on our office-to-district map.</>}
          {residualNoOffice(head) > 0 && (
            <> Lines with no office: <strong>{fmt.php(residualNoOffice(head))}</strong>{head.no_office_rows ? ` in ${head.no_office_rows.toLocaleString()} ${head.no_office_rows === 1 ? 'line' : 'lines'}` : ''}.</>
          )}
          {residualOfficeChange(head) > 0 && (
            <>
              {' '}Lines that changed office between the NEP and the House bill: <strong>{fmt.php(residualOfficeChange(head))}</strong>
              {head.office_change_rows ? ` in ${head.office_change_rows.toLocaleString()} ${head.office_change_rows === 1 ? 'line' : 'lines'}` : ''}, held out of every district.
            </>
          )}
          {' '}The district cards carry the remaining <strong>{fmt.php(head.deo_php)}</strong> ({fmt.pct(1 - share, 1)}).
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
                <th className="num" title="House bill lines the source lists under no office: in no district">Lines with no office</th>
                <th className="num" title="Lines whose NEP and House bill sides name different office groups: held out of every district">Lines that changed office</th>
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
                    <td className="num">{fmt.php(residualNoOffice(y), { unit: 'full' })}</td>
                    <td className="num">{fmt.php(residualOfficeChange(y), { unit: 'full' })}</td>
                    <td className="num">{fmt.php(residualUnattributed(y), { unit: 'full' })}{off != null && ` (${fmt.pct(off, 1)})`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unmatched.length > 0 && (
          <p className="hgab-res-unmatched">
            Offices we could not place: office names listed in a year’s budget that match no office on our
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

/**
 * "Shared" with the details on hover, focus or tap: the office's total is not
 * split, and which other districts it serves (links). Keeps the co-served
 * districts one step away instead of a paragraph on every card.
 */
export function SharedLabel({ ids, index }: { ids: readonly string[]; index: HgabDistrictIndex }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const n = ids.length + 1;
  return (
    <span
      className={`hgab-dc-shared ${open ? 'is-open' : ''}`.trim()}
      ref={wrapRef}
      // Hover opens it only for a real mouse; a tap would fire both hover and click and cancel itself.
      onPointerEnter={(e) => { if (e.pointerType !== 'mouse') return; window.clearTimeout(closeTimer.current); setOpen(true); }}
      onPointerLeave={(e) => { if (e.pointerType !== 'mouse') return; closeTimer.current = window.setTimeout(() => setOpen(false), 150); }}
    >
      <button
        type="button"
        className="hgab-dc-shared-btn"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((v) => !v)}
      >
        Shared <span aria-hidden="true">ⓘ</span>
        <span className="visually-hidden">: office total not split; show the {n} legislative districts it serves</span>
      </button>
      <span id={popId} className="hgab-dc-shared-pop" role="note" hidden={!open}>
        <strong>Shared office total, not split.</strong> This DPWH office serves {n} legislative districts. Its
        figures are the whole office’s; do not add the cards together.
        {ids.length > 0 && (
          <span className="hgab-dc-shared-list">
            Also serves: <CoServedLinks ids={ids} index={index} />
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The 2027 groups as the card's first tab shows them: what each is called,
 * what it means in a few words, and the sign it contributes to House − NEP.
 * Insertion and deletion candidates lead because they are what readers ask
 * about; unchanged comes last, for scale.
 */
const BRIDGE_TAB_ROWS: ReadonlyArray<{ group: BridgeGroup; label: string; sub: string; sign: '+' | '−' | '±' | '' }> = [
  { group: 'house_only', label: 'Insertion candidates', sub: 'in the House bill only', sign: '+' },
  { group: 'nep_only', label: 'Deletion candidates', sub: 'in the NEP only', sign: '−' },
  { group: 'increased', label: 'Increases', sub: 'higher in the House bill', sign: '+' },
  { group: 'decreased', label: 'Decreases', sub: 'lower in the House bill', sign: '−' },
  { group: 'scope_review', label: 'Scope review', sub: 'same road, different stretch', sign: '±' },
  { group: 'unchanged', label: 'Unchanged', sub: 'same amount in both', sign: '' },
];

/** "+₱315.6M", "−₱25.0M", "₱688.8M"; "—" when the group is empty. */
function bridgeAmount(sign: string, rows: number, php: number): string {
  if (!rows && !php) return '—';
  const s = sign === '±' ? (php > 0 ? '+' : php < 0 ? '−' : '±') : sign;
  return `${s}${fmt.php(Math.abs(php))}`;
}

/**
 * NEP → House bill on the same named projects and the net change, tinted
 * green when the House bill is higher and red when it is lower (the sign and
 * the words say the same). The card's 2027 headline; `compact` is the one-line
 * form an office heading in the list uses. `scope` is the hover text.
 */
export function Fy27Headline({ nep, hgab3, net, compact = false, scope = 'Same named projects in both documents' }: {
  nep: number | null;
  hgab3: number | null;
  net: number | null;
  compact?: boolean;
  scope?: string;
}) {
  const tone = net == null ? 'is-flat' : net > 0 ? 'is-up' : net < 0 ? 'is-down' : 'is-flat';
  return (
    <div className={`hgab-dc-br-headline ${tone} ${compact ? 'is-compact' : ''}`.trim()} title={scope}>
      <span className="hgab-dc-br-flow">
        <span className="hgab-dc-br-stage">
          <small>NEP</small>
          <strong title={fmt.php(nep, { unit: 'full' })}>{fmt.php(nep)}</strong>
        </span>
        <span className="hgab-dc-br-arrow" aria-hidden="true">→</span>
        <span className="hgab-dc-br-stage">
          <small>House bill</small>
          <strong title={fmt.php(hgab3, { unit: 'full' })}>{fmt.php(hgab3)}</strong>
        </span>
      </span>
      <span className="hgab-dc-br-netbig" title={`House bill minus the NEP, same named projects: ${fmt.php(net, { unit: 'full' })}`}>
        <small>Net change</small>
        <SignedPhp value={net} />
      </span>
    </div>
  );
}

/**
 * One office's 2027 comparison inside a district card: NEP → House bill on
 * the same named projects and the net change, a five-part bar of how much
 * money moved in each kind of change (cuts hatched, so it reads without
 * colour), then every group with its count and pesos. The notes the source
 * requires stay with it: insertion candidates include unconfirmed matches,
 * and lines whose office changed between the documents are held out.
 */
export function OfficeBridgePanel({ office, withName = false }: { office: OfficeHistory; withName?: boolean }) {
  const f = office.fy2027;
  const b = f?.bridge ?? null;
  const change = f?.office_change;
  const name = withName ? <p className="hgab-dc-br-office">{dpwhOfficeName(office.name)}</p> : null;
  if (!f || !b) {
    return (
      <div className="hgab-dc-br">
        {name}
        <p className="hgab-dc-br-empty">No 2027 project comparison for this office.</p>
      </div>
    );
  }
  const moving = BRIDGE_TAB_ROWS.filter((r) => r.group !== 'unchanged');
  const moved = moving.reduce((a, r) => a + Math.abs(b[r.group]?.php ?? 0), 0);
  const barLabel = moving
    .map((r) => `${r.label} ${bridgeAmount(r.sign, b[r.group]?.rows ?? 0, b[r.group]?.php ?? 0)}`)
    .join(', ');
  return (
    <div className="hgab-dc-br">
      {name}
      <Fy27Headline nep={f.nep_php} hgab3={f.hgab3_php} net={b.net_php} />
      {moved > 0 && (
        <span className="hgab-dc-br-bar" role="img" aria-label={`How the House bill differs from the NEP: ${barLabel}`}>
          {moving.map((r) => {
            const v = Math.abs(b[r.group]?.php ?? 0);
            return v > 0 ? <span key={r.group} className={`is-${r.group}`} style={{ width: `${(v / moved) * 100}%` }} /> : null;
          })}
        </span>
      )}
      <dl className="hgab-dc-br-grid">
        {BRIDGE_TAB_ROWS.map((r) => {
          const cell = b[r.group] ?? { rows: 0, php: 0 };
          return (
            <div key={r.group} className={`hgab-dc-br-cell is-${r.group} ${cell.rows ? '' : 'is-zero'}`.trim()} title={bridgeGroupTitle(r.group)}>
              <dt>
                {r.label}
                <small>{r.sub}</small>
              </dt>
              <dd>
                <strong>{bridgeAmount(r.sign, cell.rows, cell.php)}</strong>
                <span>{cell.rows.toLocaleString()} {cell.rows === 1 ? 'project' : 'projects'}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="hgab-dc-br-note">
        Candidates are leads to check, not findings. Insertion candidates include lines whose NEP match is unconfirmed.
      </p>
      {change && change.rows > 0 && (
        <p className="hgab-dc-br-note is-office-change">
          {change.rows.toLocaleString()} {change.rows === 1 ? 'line' : 'lines'} changed office between the NEP and the House bill:
          held out of every district, and not in these figures.
        </p>
      )}
    </div>
  );
}

/**
 * Accessible tabs inside a card: a tablist with roving focus (arrow keys,
 * Home, End) and panels stacked in one grid cell, so the card keeps the
 * height of its tallest panel and nothing below it jumps when the tab
 * changes. Inactive panels are hidden from sight and from assistive
 * technology (visibility), not removed from layout.
 */
function CardTabs({ label, tabs }: { label: string; tabs: ReadonlyArray<{ key: string; label: string; panel: ReactNode }> }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (active + 1) % n;
    else if (e.key === 'ArrowLeft') next = (active - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="hgab-dc-tabs">
      <div className="hgab-dc-tablist" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${t.key}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="hgab-dc-panels">
        {tabs.map((t, i) => (
          <div
            key={t.key}
            role="tabpanel"
            id={`${base}-panel-${t.key}`}
            aria-labelledby={`${base}-tab-${t.key}`}
            className={`hgab-dc-panel ${i === active ? 'is-active' : ''}`.trim()}
            tabIndex={i === active ? 0 : -1}
          >
            {t.panel}
          </div>
        ))}
      </div>
    </div>
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
 * One legislative district: who holds the seat, which DPWH office(s) serve it, the
 * office history by Congress, the headline figures (labelled shared when the
 * office is), the one-line 2027 summary, and the links out. Memoised: the grid
 * draws 250 of these, each with an SVG, and typing in the search box must not
 * redraw them.
 */
export const DistrictCardView = memo(function DistrictCardView({ card, index, level = 3 }: {
  card: DistrictCard;
  index: HgabDistrictIndex;
  /** 4 under a region heading (h3), 5 under an office heading (h4), 3 in the flat list. */
  level?: 3 | 4 | 5;
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
  const Heading = level === 5 ? 'h5' : level === 4 ? 'h4' : 'h3';
  const regionKey = districtRegionKey(card);

  return (
    // `id` is the card's `#d-…` address: the sidebar scrolls here, and the
    // heading takes focus (tabIndex −1) so a keyboard reader lands on it.
    <article className="hgab-dc" id={districtAnchor(card.id)} data-attribution={card.attribution} aria-labelledby={hid}>
      <header className="hgab-dc-head">
        {!ambiguous && <Portrait rep={rep} />}
        <div className="hgab-dc-title">
          <p className="hgab-dc-eyebrow">
            <span title={card.region ?? undefined}>{regionKey === 'other' ? card.region ?? 'Region not recorded' : regionNames(regionKey).name}</span>
            <AttributionBadge attribution={card.attribution} />
          </p>
          <Heading className="hgab-dc-district" id={hid} tabIndex={-1}>
            <Link to={districtPath(card.id)}>{card.label}</Link>
            <DeoBadges offices={offices.map((o) => o.name)} jurisdiction={card.jurisdiction} />
          </Heading>
          <RepresentativeBlock rep={rep} />
        </div>
      </header>

      {(groups.length > 0 || offices.length === 0) && (
        <ul className="hgab-dc-offices">
          {groups.map((g) => (
            <li key={g.id} className="hgab-dc-nooffice">
              {g.name} is a regional grouping, not a DPWH district engineering office (DEO). Its money is not assigned to a district and appears on no card.
            </li>
          ))}
          {offices.length === 0 && groups.length === 0 && <li className="hgab-dc-nooffice">{ATTRIBUTION_LABELS.none.help}</li>}
        </ul>
      )}

      {undivided && (
        <p className="hgab-dc-undivided">
          <SharedLabel ids={coServed} index={index} />
        </p>
      )}
      {!undivided && offices.length > 1 && (
        <p className="hgab-dc-undivided is-sum">Total of {offices.length} DPWH offices</p>
      )}

      {offices.length > 0 && (
        <CardTabs
          label={`${card.label}: 2027 comparison or budget history`}
          tabs={[
            {
              key: 'fy2027',
              label: '2027: NEP vs House bill',
              panel: (
                <div className="hgab-dc-fy27">
                  {offices.map((o) => <OfficeBridgePanel key={o.id} office={o} withName={offices.length > 1} />)}
                </div>
              ),
            },
            {
              key: 'history',
              label: 'History',
              panel: (
                <div className="hgab-dc-history">
                  {offices.map((o, i) => (
                    <div className="hgab-dc-chartrow" key={o.id}>
                      <div className="hgab-dc-chartrow-head">
                        <span title={dpwhOfficeName(o.name)}>{dpwhOfficeName(o.name)}{offices.length > 1 ? ` · office ${i + 1} of ${offices.length}` : ''}</span>
                        <TierBadge tier={o.tier} sharedWith={Math.max(0, o.district_ids.length - 1)} compact />
                      </div>
                      <HistoryChart office={o} max={max || undefined} />
                    </div>
                  ))}
                  <dl className="hgab-dc-figures">
                    <div><dt title={`${FISCAL_STAGE_LONG.gaa} Whole office.`}>2026 enacted</dt><dd><Figure v={h.fy2026_gaa_php} /></dd></div>
                    <div>
                      <dt title={`${FISCAL_STAGE_LONG.nep} Whole office; not the figure the 2027 tab compares.`}>2027 NEP</dt>
                      <dd><Figure v={h.fy2027_nep_php} /></dd>
                    </div>
                    <div>
                      <dt title={`${FISCAL_STAGE_LONG.hgab3} Named projects only.`}>2027 House bill</dt>
                      <dd>
                        <Figure v={h.fy2027_hgab3_php} />
                        {fy27.delta_php != null && (
                          <span
                            className="hgab-delta-line"
                            title={`House bill (third reading) against the NEP, same named projects: NEP ${fmt.php(fy27.nep_php, { unit: 'full' })} → House bill ${fmt.php(fy27.hgab3_php, { unit: 'full' })}`}
                          >
                            <SignedPhp value={fy27.delta_php} /> <span className="hgab-delta">vs the NEP, same projects</span>
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              ),
            },
          ]}
        />
      )}

      <footer className="hgab-card-ctas">
        <Link className="hgab-cta hgab-cta-primary" to={districtPath(card.id)}>Open district →</Link>
        {offices.map((o) => (
          <Link key={o.id} className="hgab-cta" to={officeProjectsHref(o)} title={`Every DPWH project recorded under ${officeParquetLabel(o)}`}>
            Projects{offices.length > 1 ? ` · ${o.name}` : ''}
          </Link>
        ))}
        {!ambiguous && rep?.juris_url && (
          <a className="hgab-cta hgab-cta-quiet" href={rep.juris_url} target="_blank" rel="noopener noreferrer" title="Bills and profile on bills.juris.ph">More Info ↗</a>
        )}
      </footer>
    </article>
  );
});
