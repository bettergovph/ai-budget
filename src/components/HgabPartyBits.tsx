/**
 * Small pieces shared by the page by party and each party's page: a party's name (linked to its page), and the thin
 * share bar. Helpers that are not components live in lib/hgab-parties-view.ts.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SHARED_KEY, partyFull, partyName, partyPath } from '../lib/hgab-parties';

/** A party's name, with the ballot abbreviation after it where the two differ; linked to its page unless `plain`. */
export function PartyName({ code, sub, plain = false }: { code: string | null; sub?: ReactNode; plain?: boolean }) {
  if (!code) return <span className="hgab-pty-party is-none">No party in the results</span>;
  const name = (
    <>
      {partyName(code)}
      {partyName(code) !== code && <span className="hgab-pty-code">{code}</span>}
    </>
  );
  return (
    <span className="hgab-pty-party" title={partyFull(code)}>
      {plain ? name : <Link to={partyPath(code)} className="hgab-pty-plink">{name}</Link>}
      {sub && <span className="hgab-pty-sub">{sub}</span>}
    </span>
  );
}

/** The offices shared across parties, linked to their page. */
export function SharedName({ sub }: { sub?: ReactNode }) {
  return (
    <span className="hgab-pty-party">
      <Link to={partyPath(SHARED_KEY)} className="hgab-pty-plink">Offices shared across parties</Link>
      {sub && <span className="hgab-pty-sub">{sub}</span>}
    </span>
  );
}

/** A share drawn as a thin bar, on a scale where `max` fills the bar's box. The figure beside it carries the value. */
export function ShareBar({ value, max, tone }: { value: number; max: number; tone: 'seats' | 'budget' | 'total' }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <span className={`hgab-pty-bar is-${tone}`} aria-hidden="true">
      <span style={{ width: `${w}%` }} />
    </span>
  );
}

/** One figure with its share bar under it, and an optional note line: the cells of the party tables. */
export function Metric({ value, share, max, tone, title, note }: {
  value: ReactNode; share: number | null; max: number; tone: 'seats' | 'budget' | 'total'; title?: string; note?: ReactNode;
}) {
  return (
    <span className="hgab-pty-metric" title={title}>
      <span className="hgab-pty-mv">{value}</span>
      {share != null && (
        <span className="hgab-pty-ms"><ShareBar value={share} max={max} tone={tone} /><span className="hgab-pty-pct">{(share * 100).toFixed(1)}%</span></span>
      )}
      {note && <span className="hgab-pty-sub">{note}</span>}
    </span>
  );
}
