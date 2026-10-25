/**
 * `/hgab/2027/intro` — the HGAB section's landing page as a story deck: a
 * vertical run of short numbered chapters, one idea and one chart each, in
 * the manner of the FY2027 NEP deck (`Nep2027Story`). The dense dashboard it
 * replaces as the landing stays at `/hgab/2027/overview`.
 *
 * Every figure is computed here from `overview.json`, the four
 * `<dataset>/summary.json` files and, best-effort, `districts.json`; nothing
 * is restated by hand. Counts and pesos are never summed across programs or
 * across stages: the four programs have different record grains, and NEP,
 * HGAB 2R and HGAB 3R are separate printings to be compared, not added.
 *
 * Copy: plain first. Captions, notes and the finale use the section's plain
 * words (lib/hgab-ui `PLAIN`, `COMPARE_NOT_ADD`; lib/hgab `PLAIN_TERMS`), each
 * acronym is expanded the first time it appears, and the technical detail
 * lives on Methodology rather than in a chapter.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabLoading, WhatThisMeans } from '../components/HgabBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  BRIDGE_LABELS, DATASET_ORDER, HGAB_ROOT, PLAIN_TERMS, STAGE_LABELS, datasetPath, districtPath, formatPct,
  loadHgabDataset, loadHgabDistricts, loadHgabOverview, pctChange, recordPath,
  type BridgeGroup, type ControlRow, type DatasetKey, type HgabDatasetMeta, type HgabDatasetSummary,
  type HgabDistrictIndex, type HgabOverview, type ResidualYear,
} from '../lib/hgab';
import { COMPARE_NOT_ADD, DATASET_SHORT, PLAIN, plainControlsLabel } from '../lib/hgab-ui';
import '../nep2027.css';
import '../nep2027-story.css';
import '../hgab-intro.css';

interface Loaded {
  ov: HgabOverview;
  summaries: Record<DatasetKey, HgabDatasetSummary>;
}

const NEP = STAGE_LABELS.nep.short;
const H3 = STAGE_LABELS.hgab3.short;
const H2 = STAGE_LABELS.hgab2.short;

/** Segments of the DPWH bridge composition bar, in reading order. */
const COMPOSITION: readonly BridgeGroup[] = ['unchanged', 'increased', 'decreased', 'house_only', 'nep_only', 'scope_review'];

const ANNEXES: readonly DatasetKey[] = ['fmr', 'hfep', 'nia'];

const TENTHS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

export default function HgabIntro() {
  const [data, setData] = useState<Loaded | null>(null);
  const [districts, setDistricts] = useState<HgabDistrictIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = pageMeta(`${HGAB_ROOT}/intro`).title;
    Promise.all([
      loadHgabOverview(),
      loadHgabDataset('dpwh'), loadHgabDataset('fmr'), loadHgabDataset('hfep'), loadHgabDataset('nia'),
    ])
      .then(([ov, dpwh, fmr, hfep, nia]) => setData({ ov, summaries: { dpwh, fmr, hfep, nia } }))
      .catch((e) => setErr(String(e?.message || e)));
    // Best effort: the offices chapter is omitted when the district index is unavailable.
    loadHgabDistricts().then(setDistricts).catch(() => { /* chapter omitted */ });
  }, []);

  // Chapter reveal, as in the NEP deck: sections rise in as they enter the
  // viewport; reduced-motion users get everything visible at once (CSS).
  useEffect(() => {
    if (!data) return;
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    root.querySelectorAll('.story-reveal:not(.is-in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [data, districts]);

  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the FY2027 House bill introduction" heroBlend />;

  const { ov, summaries } = data;
  const byKey = new Map(ov.datasets.map((d) => [d.key, d]));
  const datasets = DATASET_ORDER.map((k) => byKey.get(k)).filter((d): d is HgabDatasetMeta => Boolean(d));
  const dpwhMeta = byKey.get('dpwh') ?? null;
  const dpwh = summaries.dpwh;

  // --- 02 · DPWH by program ---------------------------------------------
  const programs = (dpwh.dims.program ?? [])
    .map((r) => ({ ...r, delta: r.house_php - r.nep_php }))
    .sort((a, b) => b.delta - a.delta);
  const dpwhDelta = dpwhMeta ? delta(dpwhMeta) : null;

  // --- 03 · Foreign-assisted projects --------------------------------------
  const fap = dpwh.controls.find((c) => /foreign-assisted/i.test(c.label)) ?? null;
  const fapDelta = fap && fap.nep_php != null && fap.hgab3_php != null ? fap.hgab3_php - fap.nep_php : null;
  const fapCuts = (dpwh.top.decreased ?? [])
    .filter((r) => r.zone === 'fap' && r.delta_php != null && r.nep_php != null && r.hgab3_php != null)
    .sort((a, b) => (a.delta_php ?? 0) - (b.delta_php ?? 0))
    .slice(0, 5);

  // --- 04 · The bridge ------------------------------------------------------
  const bridge = dpwhMeta?.bridge ?? null;
  const topIncreased = dpwh.controls
    .filter((c): c is ControlRow & { delta_php: number } => c.delta_php != null && c.delta_php > 0)
    .sort((a, b) => b.delta_php - a.delta_php)
    .slice(0, 3);

  // --- 05 · By region --------------------------------------------------------
  const regions = (dpwh.dims.region ?? []).map((r) => ({ ...r, delta: r.house_php - r.nep_php }));
  const byAbs = [...regions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topRegions = byAbs.slice(0, 8).sort((a, b) => b.delta - a.delta);
  const otherRegions = byAbs.slice(8);
  const otherNep = otherRegions.reduce((a, r) => a + r.nep_php, 0);
  const otherHouse = otherRegions.reduce((a, r) => a + r.house_php, 0);
  const regionMax = Math.max(1, ...regions.flatMap((r) => [r.nep_php, r.house_php]));
  const regionsUp = regions.filter((r) => r.delta > 0).length;
  const lowestRegion = [...regions].sort((a, b) => a.delta - b.delta)[0] ?? null;

  // --- 06 · Readings ----------------------------------------------------------
  const rd = dpwh.readings;

  // --- 07 · Annexes -----------------------------------------------------------
  const annexes = ANNEXES
    .map((k) => ({ key: k, meta: byKey.get(k), s: summaries[k] }))
    .filter((a): a is { key: DatasetKey; meta: HgabDatasetMeta; s: HgabDatasetSummary } => Boolean(a.meta));

  // --- 08 · Offices (districts.json, best effort) ----------------------------
  const resid27 = districts?.residual.find((y) => y.fy === 2027 && y.stage === 'hgab3') ?? null;
  const resid26 = districts?.residual.find((y) => y.fy === 2026 && y.stage === 'gaa') ?? null;
  const coShare = resid27 && resid27.total_php ? resid27.central_office_php / resid27.total_php : null;
  const coTenths = coShare == null ? null : Math.min(10, Math.max(0, Math.round(coShare * 10)));

  const built = ov.built_at ? new Date(ov.built_at) : null;
  const commit = ov.source_commit?.slice(0, 7) ?? '';

  let n = 0;
  const next = () => ++n;

  return (
    <>
      <HgabHeader crumb="Intro" heroBlend />

      <main ref={rootRef} className="story hgab-intro">
        {/* ---- Hero ---- */}
        <section className="story-band story-hero hgi-hero">
          <div className="story-hero-inner">
            <h1 className="story-hero-title">House Budget Analysis</h1>
            <span className="story-scroll-cue" aria-hidden="true">Scroll ↓</span>
          </div>
        </section>

        {/* ---- 01 · Four programs ---- */}
        <Chapter n={next()} kicker="Four programs" id="hgi-ch-programs" title="Four programs, listed project by project.">
          <p className="story-lede">Four of the bill’s programs, not the whole bill.</p>
          <div className="hgi-pairs">
            {datasets.map((d) => <PairedBars key={d.key} d={d} />)}
          </div>
          <p className="hgi-note">
            “{NEP}” is the budget the President submits to Congress each August. “{H3}” is the House bill
            as passed on third reading. Each pair of bars has its own scale.
          </p>
          {dpwhMeta && (
            <p className="hgi-note">
              The DPWH figures cover the project lists compared here, not the whole department. The totals published for the whole department are{' '}
              <span title={exact(dpwhMeta.printed?.nep_new_appropriations_php)}>{peso(dpwhMeta.printed?.nep_new_appropriations_php)}</span> in
              the NEP and{' '}
              <span title={exact(dpwhMeta.printed?.house_new_appropriations_php)}>{peso(dpwhMeta.printed?.house_new_appropriations_php)}</span> in
              the House bill.
            </p>
          )}
        </Chapter>

        {/* ---- 02 · DPWH by program ---- */}
        {dpwhMeta && programs.length > 0 && (
          <Chapter
            n={next()}
            kicker="DPWH by program"
            id="hgi-ch-dpwh"
            tint
            title={`DPWH: ${peso(Math.abs(dpwhDelta ?? 0))} ${(dpwhDelta ?? 0) >= 0 ? 'above' : 'below'} the NEP, moved between programs.`}
          >
            <p className="hgi-figline">
              {NEP} <strong title={exact(dpwhMeta.totals.nep_php)}>{peso(dpwhMeta.totals.nep_php)}</strong> →{' '}
              {H3} <strong title={exact(houseTotal(dpwhMeta))}>{peso(houseTotal(dpwhMeta))}</strong>
              {' '}<span className={`hgi-signed ${tone(dpwhDelta)}`} title={exact(dpwhDelta)}>{signed(dpwhDelta)}</span>
              {' '}<span className="hgi-muted">{formatPct(pctChange(houseTotal(dpwhMeta), dpwhMeta.totals.nep_php))}</span>
            </p>
            <Diverging
              label={`${H3} minus ${NEP} by DPWH program, ${programs.length} bars: ${programs.map((p) => `${p.label} ${signed(p.delta)}`).join(', ')}`}
              caption={`${H3} minus ${NEP} by DPWH program`}
              rows={programs.map((p) => ({
                key: p.label,
                label: p.label,
                sub: `${NEP} ${peso(p.nep_php)} → ${H3} ${peso(p.house_php)}`,
                delta: p.delta,
              }))}
            />
            <p className="hgi-note">
              Each bar is the House bill minus the NEP for one DPWH program, as published.
              Foreign-assisted projects are listed on their own.
            </p>
            <Link className="story-cta" to={datasetPath('dpwh')}>Open DPWH →</Link>
          </Chapter>
        )}

        {/* ---- 03 · Foreign-assisted projects ---- */}
        {fap && fapDelta != null && (
          <Chapter
            n={next()}
            kicker="Foreign-assisted projects"
            id="hgi-ch-fap"
            title={`Foreign-assisted projects: ${peso(Math.abs(fapDelta))} ${fapDelta <= 0 ? 'less' : 'more'} than in the NEP.`}
          >
            <p className="story-big-num hgi-big" title={exact(fapDelta)}>{signed(fapDelta)}</p>
            <p className="hgi-figline">
              {NEP} <strong title={exact(fap.nep_php)}>{peso(fap.nep_php)}</strong> →{' '}
              {H3} <strong title={exact(fap.hgab3_php)}>{peso(fap.hgab3_php)}</strong>
              {' '}<span className="hgi-muted">{formatPct(pctChange(fap.hgab3_php, fap.nep_php))} · the DPWH program line “{fap.label}”</span>
            </p>
            {fapCuts.length > 0 && (
              <>
                <h3 className="hgi-sub-h">The {fapCuts.length === 5 ? 'five' : fapCuts.length} largest cuts to matched projects, {NEP} → {H3}</h3>
                <ol className="hgi-rank">
                  {fapCuts.map((r) => {
                    const max = Math.max(1, ...fapCuts.map((x) => x.nep_php ?? 0));
                    return (
                      <li key={r.id}>
                        <span className="hgi-rank-name">
                          <Link to={recordPath('dpwh', r.id)} title={r.title}>{r.title}</Link>
                          <span className="hgi-rank-meta">{r.region ?? '—'}</span>
                        </span>
                        <span className="hgi-rank-bars" role="img" aria-label={`${NEP} ${peso(r.nep_php)}, ${H3} ${peso(r.hgab3_php)}`}>
                          <span className="is-nep" style={{ width: `${((r.nep_php ?? 0) / max) * 100}%` }} />
                          <span className="is-house" style={{ width: `${((r.hgab3_php ?? 0) / max) * 100}%` }} />
                        </span>
                        <span className="hgi-rank-amts">
                          <span title={exact(r.nep_php)}>{peso(r.nep_php)}</span>
                          <span className="hgi-rank-arrow" aria-hidden="true">→</span>
                          <span title={exact(r.hgab3_php)}>{peso(r.hgab3_php)}</span>
                        </span>
                        <strong className={`hgi-signed ${tone(r.delta_php)}`} title={exact(r.delta_php)}>{signed(r.delta_php)}</strong>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            <p className="hgi-note">
              A foreign-assisted project is paid for partly with a loan or grant from abroad. These are
              the same projects at lower House amounts, as published.
            </p>
            <Link className="story-cta" to={datasetPath('dpwh', 'changes')}>All DPWH changes →</Link>
          </Chapter>
        )}

        {/* ---- 04 · The bridge ---- */}
        {bridge && (
          <Chapter
            n={next()}
            kicker="How the two versions differ"
            id="hgi-ch-bridge"
            tint
            title={`${peso(bridge.house_only.php)} in House lines has no match in the NEP.`}
          >
            <p className="hgi-figline">
              <strong>{bridge.house_only.rows.toLocaleString()}</strong> DPWH lines are in the House bill only.{' '}
              <strong>{bridge.nep_only.rows.toLocaleString()}</strong> lines,{' '}
              <strong title={exact(bridge.nep_only.php)}>{peso(bridge.nep_only.php)}</strong>, are in the NEP only.
            </p>
            <Composition bridge={bridge} />
            <WhatThisMeans>{PLAIN.bridgeMeans}</WhatThisMeans>
            {topIncreased.length > 0 && (
              <>
                <h3 className="hgi-sub-h">Program lines with the largest increases, House bill minus the NEP</h3>
                <ol className="hgi-rank hgi-rank-tight">
                  {topIncreased.map((c) => (
                    <li key={c.id}>
                      <span className="hgi-rank-name">
                        <Link to={datasetPath('dpwh')} title={c.label}>{c.label}</Link>
                        <span className="hgi-rank-meta">{c.group ?? ''}</span>
                      </span>
                      <span className="hgi-rank-amts">
                        <span title={exact(c.nep_php)}>{peso(c.nep_php)}</span>
                        <span className="hgi-rank-arrow" aria-hidden="true">→</span>
                        <span title={exact(c.hgab3_php)}>{peso(c.hgab3_php)}</span>
                      </span>
                      <strong className={`hgi-signed ${tone(c.delta_php)}`} title={exact(c.delta_php)}>{signed(c.delta_php)}</strong>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p className="hgi-note">
              House-only lines are insertion candidates: leads to check, not confirmed additions. A
              renamed project can look new. Each segment’s width is that group’s amount, not a share
              of a total.
            </p>
            <Link className="story-cta" to={`${HGAB_ROOT}/methodology#bridge`}>How the groups are worked out →</Link>
          </Chapter>
        )}

        {/* ---- 05 · By region ---- */}
        {regions.length > 0 && (
          <Chapter
            n={next()}
            kicker="By region"
            id="hgi-ch-region"
            title={
              `By region: ${regionsUp} of ${regions.length} above the NEP` +
              (lowestRegion && lowestRegion.delta < 0 ? `; ${lowestRegion.label} ${peso(Math.abs(lowestRegion.delta))} below.` : '.')
            }
          >
            <Dumbbell
              rows={topRegions}
              max={regionMax}
              label={`${NEP} and ${H3} DPWH totals by region, eight largest movements: ${topRegions.map((r) => `${r.label} ${NEP} ${peso(r.nep_php)}, ${H3} ${peso(r.house_php)}, ${signed(r.delta)}`).join('; ')}`}
              caption={`${NEP} and ${H3} DPWH totals by region`}
              other={otherRegions.length ? { count: otherRegions.length, nep: otherNep, house: otherHouse } : null}
            />
            <p className="hgi-note">Each document’s amounts are counted under the region that document lists.</p>
            <Link className="story-cta" to={datasetPath('dpwh', 'projects')}>DPWH projects by region →</Link>
          </Chapter>
        )}

        {/* ---- 06 · Readings ---- */}
        {rd && (
          <Chapter
            n={next()}
            kicker="Second to third reading"
            id="hgi-ch-readings"
            tint
            title={`Second to third reading: ${signed(rd.delta_php)}.`}
          >
            <p className="hgi-note">{PLAIN_TERMS.reading.meaning}</p>
            <p className="hgi-figline">
              {H2} <strong title={exact(rd.second_php)}>{peso(rd.second_php)}</strong> →{' '}
              {H3} <strong title={exact(rd.third_php)}>{peso(rd.third_php)}</strong>
              {' '}<span className="hgi-muted">· DPWH · {rd.third_only.length.toLocaleString()} lines new at third reading</span>
            </p>
            <div className="hgi-readings">
              <div>
                <h3 className="hgi-sub-h">Lines new at third reading ({rd.third_only.length})</h3>
                <ol className="hgi-rank hgi-rank-new">
                  {rd.third_only.map((r) => {
                    const max = Math.max(1, ...rd.third_only.map((x) => x.hgab3_php ?? 0));
                    return (
                      <li key={r.id}>
                        <span className="hgi-rank-name">
                          <Link to={recordPath('dpwh', r.id)} title={r.title}>{r.title}</Link>
                          <span className="hgi-rank-meta">{r.region ?? '—'} · not in the second-reading text</span>
                        </span>
                        <span className="hgi-rank-bars" role="img" aria-label={`${H3} ${peso(r.hgab3_php)}, not in the second-reading text`}>
                          <span className="is-house" style={{ width: `${((r.hgab3_php ?? 0) / max) * 100}%` }} />
                        </span>
                        <strong title={exact(r.hgab3_php)}>{peso(r.hgab3_php)}</strong>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div>
                <h3 className="hgi-sub-h">Program lines whose total moved ({rd.changed_controls.length})</h3>
                <ol className="hgi-rank hgi-rank-tight">
                  {rd.changed_controls.map((c) => (
                    <li key={c.id}>
                      <span className="hgi-rank-name">
                        <Link to={datasetPath('dpwh', 'readings')} title={c.label}>{c.label}</Link>
                        <span className="hgi-rank-meta">{c.group ?? ''}</span>
                      </span>
                      <span className="hgi-rank-amts">
                        <span title={exact(c.hgab2_php)}>{peso(c.hgab2_php)}</span>
                        <span className="hgi-rank-arrow" aria-hidden="true">→</span>
                        <span title={exact(c.hgab3_php)}>{peso(c.hgab3_php)}</span>
                      </span>
                      <strong className={`hgi-signed ${tone(c.reading_delta_php)}`} title={exact(c.reading_delta_php)}>{signed(c.reading_delta_php)}</strong>
                    </li>
                  ))}
                </ol>
                {(() => {
                  const pc = rd.printed_controls ?? [];
                  const na = pc.find((c) => c.id === 'new_appropriations');
                  const moved = pc.filter((c) => c.delta_php);
                  const same = pc.filter((c) => c.delta_php === 0 && c.id !== 'new_appropriations').length;
                  if (!na) return null;
                  return (
                    <p className="hgi-small">
                      DPWH’s published total for the year:{' '}
                      <span title={exact(na.second_php)}>{peso(na.second_php)}</span> at second reading and{' '}
                      <span title={exact(na.third_php)}>{peso(na.third_php)}</span> at third
                      {na.delta_php === 0 ? ', unchanged.' : `, ${signed(na.delta_php)}.`}
                      {same > 0 && ` ${same} other published totals did not move.`}
                      {moved.length > 0 && (
                        <>
                          {' These moved: '}
                          {moved.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 && ', '}
                              {c.label} <span title={exact(c.delta_php)}>{signed(c.delta_php)}</span>
                            </span>
                          ))}
                          .
                        </>
                      )}
                    </p>
                  );
                })()}
              </div>
            </div>
            <p className="hgi-note">
              {rd.third_only.length.toLocaleString()} DPWH {rd.third_only.length === 1 ? 'line appears' : 'lines appear'} only
              in the third-reading text. {rd.changed_controls.length.toLocaleString()}{' '}
              {rd.changed_controls.length === 1 ? 'program line carries' : 'program lines carry'} the difference.
            </p>
            <Link className="story-cta" to={datasetPath('dpwh', 'readings')}>Second vs third reading →</Link>
          </Chapter>
        )}

        {/* ---- 07 · The three annexes ---- */}
        {annexes.length > 0 && (
          <Chapter
            n={next()}
            kicker="The other three programs"
            id="hgi-ch-annexes"
            title={`The other ${annexes.length === 3 ? 'three' : annexes.length} programs: ${annexes.map((a) => `${DATASET_SHORT[a.key]} ${signed(delta(a.meta))}`).join(', ')}.`}
          >
            <div className="hgi-annexes">
              {annexes.map((a) => <AnnexPanel key={a.key} meta={a.meta} s={a.s} />)}
            </div>
            <p className="hgi-note">
              Each of these House lists is the same at second and third reading. Health facilities are
              shown by type of facility, not split into building, equipment and vehicle budgets.
            </p>
          </Chapter>
        )}

        {/* ---- 08 · Offices (omitted when districts.json is unavailable) ---- */}
        {resid27 && coTenths != null && (
          <Chapter
            n={next()}
            kicker="Implementing offices"
            id="hgi-ch-offices"
            tint
            title={`${TENTHS[coTenths]} in ten pesos sit with the Central Office.`}
          >
            <p className="hgi-figline">
              FY2027 {H3}, DPWH: <strong title={exact(resid27.central_office_php)}>{peso(resid27.central_office_php)}</strong> of{' '}
              <strong title={exact(resid27.total_php)}>{peso(resid27.total_php)}</strong> under Central Office
              {' '}<span className="hgi-muted">({fmt.pct(coShare, 1)})</span> ·{' '}
              <strong title={exact(resid27.deo_php)}>{peso(resid27.deo_php)}</strong> under district engineering offices
            </p>
            <Stacks rows={[{ label: `FY2027 ${H3}`, y: resid27 }, ...(resid26 ? [{ label: 'FY2026 enacted (GAA)', y: resid26 }] : [])]} />
            <p className="hgi-note">
              The 2026 bar is the enacted budget (GAA) for the whole department, all funds. The 2027 bar
              covers only the project lists compared here. Read each bar on its own.
            </p>
            <Link className="story-cta" to={districtPath()}>Open districts →</Link>
          </Chapter>
        )}

        {/* ---- Finale ---- */}
        <section className="story-band story-finale story-reveal hgi-finale" aria-labelledby="hgi-finale-h">
          <p className="story-kicker">Before the tables</p>
          <h2 className="story-h story-h-paper" id="hgi-finale-h">How to read these figures</h2>
          <ul className="hgi-rules">
            <li>Matches between the NEP and the House bill come from written rules. They are leads to check, not confirmed findings.</li>
            <li>The NEP and the House bill are {COMPARE_NOT_ADD}.</li>
            <li>Amounts are what the documents set aside, not money spent.</li>
            <li>Nothing here says any office or official did anything wrong.</li>
          </ul>
          <div className="story-ctas">
            {datasets.map((d) => (
              <Link key={d.key} to={datasetPath(d.key)}>
                <strong>{DATASET_SHORT[d.key]}</strong>
                <span>
                  {d.counts.nep.toLocaleString()} lines in the NEP · {(d.counts.hgab3 ?? d.counts.hgab2 ?? 0).toLocaleString()} in the House bill
                </span>
              </Link>
            ))}
            <Link to={districtPath()}><strong>Districts</strong><span>DPWH offices and the districts they serve</span></Link>
            <Link to={`${HGAB_ROOT}/sources`}><strong>Sources</strong><span>the documents, their fingerprints and downloads</span></Link>
            <Link to={`${HGAB_ROOT}/methodology`}><strong>Methodology</strong><span>how lines were matched, and the limits</span></Link>
          </div>
          <p className="hgi-quiet">
            Maps:{' '}
            {datasets.map((d, i) => (
              <span key={d.key}>
                {i > 0 && ' · '}
                <Link to={datasetPath(d.key, 'map')}>{DATASET_SHORT[d.key]}</Link>
              </span>
            ))}
            {' '}· <Link to={`${HGAB_ROOT}/overview`}>Dashboard view →</Link>
          </p>
          <p className="story-provenance">
            {built && `Built ${built.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })} · `}
            figures copied unchanged from{' '}
            <a href={ov.source_repo} target="_blank" rel="noopener noreferrer">the analysis repository</a>
            {commit && <> at commit <code>{commit}</code></>}
          </p>
        </section>

        <div className="hgi-after">
          <DisclaimerNotice compact />
        </div>
      </main>
      <SiteFooter source="SOURCE: HOUSE BILL 10858 (2ND & 3RD READING) · DBM NEP FY 2027 · 4 PROGRAMS" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "₱14.2B", or "—" when the stage has no record. */
function peso(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `₱${fmt.shortPhp(v)}`;
}

/** Exact pesos for a `title` attribute. */
function exact(v: number | null | undefined): string | undefined {
  return v == null || !Number.isFinite(v) ? undefined : fmt.php(v, { unit: 'full' });
}

/** "+₱14.2B", "−₱73.0B", "₱0" — typographic minus, as the rest of the site. */
function signed(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '₱0';
  return `${v > 0 ? '+' : '−'}₱${fmt.shortPhp(Math.abs(v))}`;
}

function tone(v: number | null | undefined): string {
  return v == null ? '' : v > 0 ? 'is-up' : v < 0 ? 'is-down' : '';
}

/** The House figure of a dataset: third reading when printed, else second. */
function houseTotal(d: HgabDatasetMeta): number | null {
  return d.totals.hgab3_php ?? d.totals.hgab2_php ?? null;
}

function delta(d: HgabDatasetMeta): number | null {
  const h = houseTotal(d);
  return h == null ? null : h - d.totals.nep_php;
}

/** "Region IVA - CALABARZON" → "Region IVA"; everything else as printed. */
function shortLabel(label: string): string {
  const m = /^(Region [A-Z0-9-]+)\s+-\s+/i.exec(label);
  if (m) return m[1];
  const paren = /\(([A-Z]{2,5})\)\s*$/.exec(label);
  if (paren && label.length > 24) return paren[1];
  return label;
}

// ---------------------------------------------------------------------------
// Chapter shell
// ---------------------------------------------------------------------------

function Chapter({
  n, kicker, id, title, tint = false, children,
}: {
  n: number;
  kicker: string;
  id: string;
  title: string;
  tint?: boolean;
  children: ReactNode;
}) {
  const inner = (
    <>
      <p className="story-ch-num">{String(n).padStart(2, '0')} · {kicker}</p>
      <h2 className="story-h" id={id}>{title}</h2>
      {children}
    </>
  );
  return tint ? (
    <section className="story-chapter story-chapter-tint story-reveal hgi-chapter" aria-labelledby={id}>
      <div className="story-chapter-inner">{inner}</div>
    </section>
  ) : (
    <section className="story-chapter story-reveal hgi-chapter" aria-labelledby={id}>{inner}</section>
  );
}

/**
 * Screen-reader table beside a chart that carries more than four values. The
 * wrapper div, not the table, is the hidden box: a table never shrinks below
 * its content width, so hiding it directly would widen the page.
 */
function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <div className="visually-hidden">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 01 · Paired bars, one dataset
// ---------------------------------------------------------------------------

function PairedBars({ d }: { d: HgabDatasetMeta }) {
  const nep = d.totals.nep_php;
  const house = houseTotal(d);
  const diff = delta(d);
  const pct = pctChange(house, nep);
  const max = Math.max(1, nep, house ?? 0);
  const houseRows = d.counts.hgab3 ?? d.counts.hgab2;
  return (
    <article className="hgi-pair" aria-labelledby={`hgi-pair-${d.key}`}>
      <header>
        <p className="hgi-pair-agency">{d.agency}</p>
        <h3 id={`hgi-pair-${d.key}`}><Link to={datasetPath(d.key)}>{d.label}</Link></h3>
      </header>
      <div
        className="hgi-bars"
        role="img"
        aria-label={`${d.short}: ${NEP} ${peso(nep)}, ${H3} ${peso(house)}, difference ${signed(diff)} (${formatPct(pct)})`}
      >
        <div className="hgi-bar-row">
          <span className="hgi-bar-label">{NEP}</span>
          <span className="hgi-bar-track"><span className="hgi-bar is-nep" style={{ width: `${(nep / max) * 100}%` }} /></span>
          <span className="hgi-bar-val" title={exact(nep)}>{peso(nep)}</span>
        </div>
        <div className="hgi-bar-row">
          <span className="hgi-bar-label">{H3}</span>
          <span className="hgi-bar-track">
            {house != null && <span className="hgi-bar is-house" style={{ width: `${(house / max) * 100}%` }} />}
          </span>
          <span className="hgi-bar-val" title={exact(house)}>{peso(house)}</span>
        </div>
      </div>
      <p className="hgi-pair-delta">
        <strong className={`hgi-signed ${tone(diff)}`} title={exact(diff)}>{signed(diff)}</strong>
        <span className="hgi-muted">{pct == null ? '' : `${formatPct(pct)} vs ${NEP}`}</span>
      </p>
      <p className="hgi-pair-counts">
        {d.counts.nep.toLocaleString()} lines in the NEP · {houseRows == null ? '—' : houseRows.toLocaleString()} in the House bill
        {!d.has_readings && ' · the House list is the same at both readings'}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Diverging bars (02, 07)
// ---------------------------------------------------------------------------

interface DivergingRow {
  key: string;
  label: string;
  /** Full label for the title attribute when `label` is shortened. */
  title?: string;
  sub?: string;
  delta: number | null;
}

function Diverging({ rows, label, caption, compact = false }: { rows: DivergingRow[]; label: string; caption: string; compact?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta ?? 0)));
  return (
    <>
      <div className={`hgi-div ${compact ? 'is-compact' : ''}`.trim()} role="img" aria-label={label}>
        {rows.map((r) => {
          const w = r.delta == null ? 0 : (Math.abs(r.delta) / max) * 50;
          return (
            <div className="hgi-div-row" key={r.key}>
              <span className="hgi-div-label" title={r.title ?? r.label}>
                {r.label}
                {r.sub && <span className="hgi-div-sub">{r.sub}</span>}
              </span>
              <span className="hgi-div-track">
                <span className="hgi-div-axis" />
                {r.delta != null && r.delta !== 0 && (
                  <span
                    className={`hgi-div-bar ${r.delta > 0 ? 'is-up' : 'is-down'}`}
                    style={r.delta > 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                  />
                )}
              </span>
              <span className={`hgi-div-val hgi-signed ${tone(r.delta)}`} title={exact(r.delta)}>{signed(r.delta)}</span>
            </div>
          );
        })}
      </div>
      {rows.length > 4 && (
        <SrTable
          caption={caption}
          head={['Row', `${H3} − ${NEP}`]}
          rows={rows.map((r) => [r.title ?? r.label, signed(r.delta)])}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 04 · Bridge composition
// ---------------------------------------------------------------------------

function Composition({ bridge }: { bridge: HgabDatasetMeta['bridge'] }) {
  const cells = COMPOSITION.map((g) => ({ g, cell: bridge[g], php: Math.abs(bridge[g].php) }));
  const total = Math.max(1, cells.reduce((a, c) => a + c.php, 0));
  const series = cells.map((c) => `${BRIDGE_LABELS[c.g].label} ${peso(c.php)} (${c.cell.rows.toLocaleString()} rows)`).join(', ');
  return (
    <>
      <div className="hgi-comp" role="img" aria-label={`DPWH lines in six groups, by amount, ${H3} against ${NEP}: ${series}`}>
        {cells.map((c) => (
          <span
            key={c.g}
            className={`hgi-comp-seg is-${c.g}`}
            style={{ width: `${(c.php / total) * 100}%` }}
            title={`${BRIDGE_LABELS[c.g].label}: ${exact(c.php)}`}
          />
        ))}
      </div>
      <ul className="hgi-legend">
        {cells.map((c) => (
          <li key={c.g} className={`is-${c.g}`} title={BRIDGE_LABELS[c.g].help}>
            <span className="hgi-swatch" aria-hidden="true" />
            <span className="hgi-legend-label">
              {BRIDGE_LABELS[c.g].label}
              <span className="hgi-legend-sub">{BRIDGE_LABELS[c.g].sub}</span>
            </span>
            <span className="hgi-legend-val" title={exact(c.php)}>{peso(c.php)}</span>
            <span className="hgi-legend-rows">{c.cell.rows.toLocaleString()} lines</span>
          </li>
        ))}
      </ul>
      <SrTable
        caption={`DPWH lines in six groups, by amount, ${H3} against ${NEP}`}
        head={['Group', 'Amount', 'Lines']}
        rows={cells.map((c) => [BRIDGE_LABELS[c.g].label, peso(c.php), c.cell.rows.toLocaleString()])}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 05 · Dumbbell, NEP vs HGAB 3R by region
// ---------------------------------------------------------------------------

interface DumbbellRow { label: string; nep_php: number; house_php: number; delta: number }

function Dumbbell({
  rows, max, label, caption, other,
}: {
  rows: DumbbellRow[];
  max: number;
  label: string;
  caption: string;
  other: { count: number; nep: number; house: number } | null;
}) {
  const pos = (v: number) => `${(v / max) * 100}%`;
  return (
    <>
      <div className="hgi-dumb" role="img" aria-label={label}>
        <div className="hgi-dumb-key" aria-hidden="true">
          <span><i className="hgi-dot is-nep" /> {NEP}</span>
          <span><i className="hgi-dot is-house" /> {H3}</span>
        </div>
        {rows.map((r) => {
          const lo = Math.min(r.nep_php, r.house_php);
          const hi = Math.max(r.nep_php, r.house_php);
          return (
            <div className="hgi-dumb-row" key={r.label}>
              <span className="hgi-dumb-label">{r.label}</span>
              <span className="hgi-dumb-track">
                <span className="hgi-dumb-line" style={{ left: pos(lo), width: pos(hi - lo) }} />
                <i className="hgi-dot is-nep" style={{ left: pos(r.nep_php) }} title={`${NEP} ${exact(r.nep_php)}`} />
                <i className="hgi-dot is-house" style={{ left: pos(r.house_php) }} title={`${H3} ${exact(r.house_php)}`} />
              </span>
              <span className="hgi-dumb-vals">
                <span title={exact(r.nep_php)}>{peso(r.nep_php)}</span>
                <span className="hgi-rank-arrow" aria-hidden="true">→</span>
                <span title={exact(r.house_php)}>{peso(r.house_php)}</span>
              </span>
              <span className={`hgi-dumb-delta hgi-signed ${tone(r.delta)}`} title={exact(r.delta)}>{signed(r.delta)}</span>
            </div>
          );
        })}
      </div>
      {other && (
        <p className="hgi-dumb-other">
          Other regions ({other.count}): {NEP} <span title={exact(other.nep)}>{peso(other.nep)}</span> → {H3}{' '}
          <span title={exact(other.house)}>{peso(other.house)}</span>{' '}
          <span className={`hgi-signed ${tone(other.house - other.nep)}`} title={exact(other.house - other.nep)}>{signed(other.house - other.nep)}</span>
        </p>
      )}
      <SrTable
        caption={caption}
        head={['Region', NEP, H3, `${H3} − ${NEP}`]}
        rows={[
          ...rows.map((r) => [r.label, peso(r.nep_php), peso(r.house_php), signed(r.delta)]),
          ...(other ? [[`Other regions (${other.count})`, peso(other.nep), peso(other.house), signed(other.house - other.nep)]] : []),
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 07 · One annex panel
// ---------------------------------------------------------------------------

function AnnexPanel({ meta, s }: { meta: HgabDatasetMeta; s: HgabDatasetSummary }) {
  const house = houseTotal(meta);
  const diff = delta(meta);
  // HFEP prints funding-column controls (Infrastructure, Medical equipment,
  // Motor vehicle, Total) beside its categories; the panel lists categories only.
  const controls = s.controls
    .filter((c) => !c.id.startsWith('column:'))
    .sort((a, b) => (b.delta_php ?? -Infinity) - (a.delta_php ?? -Infinity));
  // "Regions" → "region", "Sub-programs" → "sub-program", "Categories" → "category".
  const byLabel = plainControlsLabel(meta.controls_label).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
  return (
    <article className="hgi-annex" aria-labelledby={`hgi-annex-${meta.key}`}>
      <p className="hgi-pair-agency">{meta.agency}</p>
      <h3 id={`hgi-annex-${meta.key}`}><Link to={datasetPath(meta.key)}>{meta.label}</Link></h3>
      <p className="hgi-annex-delta">
        <strong className={`hgi-signed ${tone(diff)}`} title={exact(diff)}>{signed(diff)}</strong>
        <span className="hgi-muted">{formatPct(pctChange(house, meta.totals.nep_php))}</span>
      </p>
      <p className="hgi-small">
        {NEP} <span title={exact(meta.totals.nep_php)}>{peso(meta.totals.nep_php)}</span> → {H3}{' '}
        <span title={exact(house)}>{peso(house)}</span> · by {byLabel} below
      </p>
      <Diverging
        compact
        label={`${H3} minus ${NEP} by ${byLabel}, ${DATASET_SHORT[meta.key]}, ${controls.length} bars: ${controls.map((c) => `${c.label} ${signed(c.delta_php)}`).join(', ')}`}
        caption={`${DATASET_SHORT[meta.key]}: ${H3} minus ${NEP} by ${byLabel}`}
        rows={controls.map((c) => ({ key: c.id, label: shortLabel(c.label), title: c.label, delta: c.delta_php }))}
      />
      <Link className="hgi-annex-link" to={datasetPath(meta.key)}>Open {DATASET_SHORT[meta.key]} →</Link>
    </article>
  );
}

// ---------------------------------------------------------------------------
// 08 · Stacked office bars
// ---------------------------------------------------------------------------

const OFFICE_SEGMENTS: ReadonlyArray<{ key: keyof ResidualYear; cls: string; label: string }> = [
  { key: 'deo_php', cls: 'is-deo', label: 'District engineering offices' },
  { key: 'central_office_php', cls: 'is-co', label: 'Central Office' },
  { key: 'regional_offices_php', cls: 'is-ro', label: 'Regional offices' },
  { key: 'unmatched_php', cls: 'is-un', label: 'Offices we could not match' },
];

function Stacks({ rows }: { rows: Array<{ label: string; y: ResidualYear }> }) {
  const amount = (y: ResidualYear, k: keyof ResidualYear) => Number(y[k]) || 0;
  return (
    <>
      <div className="hgi-stacks">
        {rows.map(({ label, y }) => {
          const total = Math.max(1, y.total_php);
          const series = OFFICE_SEGMENTS.map((s) => `${s.label} ${peso(amount(y, s.key))} (${fmt.pct(amount(y, s.key) / total, 1)})`).join(', ');
          return (
            <div className="hgi-stack-row" key={label}>
              <span className="hgi-stack-label">
                {label}
                <span className="hgi-stack-total" title={exact(y.total_php)}>{peso(y.total_php)}</span>
              </span>
              <div className="hgi-stack" role="img" aria-label={`${label}, DPWH by implementing office: ${series}`}>
                {OFFICE_SEGMENTS.map((s) => {
                  const v = amount(y, s.key);
                  if (v <= 0) return null;
                  const share = v / total;
                  return (
                    <span key={s.key} className={`hgi-stack-seg ${s.cls}`} style={{ width: `${share * 100}%` }} title={`${s.label}: ${exact(v)}`}>
                      {share >= 0.12 && <span className="hgi-stack-pct">{fmt.pct(share, 0)}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="hgi-legend hgi-legend-offices">
        {OFFICE_SEGMENTS.map((s) => (
          <li key={s.key} className={s.cls}>
            <span className="hgi-swatch" aria-hidden="true" />
            <span className="hgi-legend-label">{s.label}</span>
          </li>
        ))}
      </ul>
      <SrTable
        caption="DPWH by implementing office, per year and version"
        head={['Year and version', ...OFFICE_SEGMENTS.map((s) => s.label), 'Total']}
        rows={rows.map(({ label, y }) => [label, ...OFFICE_SEGMENTS.map((s) => peso(amount(y, s.key))), peso(y.total_php)])}
      />
    </>
  );
}
