/**
 * "Download CSV": the menu in a program hub's page head (`/hgab/2027/:dataset`,
 * every view). It offers the program's whole project table, the table(s) of
 * the view being shown, and links to the raw files for analysts.
 *
 * Tables that are already in `summary.json` (or `map.json`) are written at
 * once. Anything that needs the parquet (all projects, the filtered projects,
 * the region of each map dot) runs DuckDB-Wasm, which is started only when such
 * an item is chosen; the item and the button say "Preparing…" meanwhile.
 *
 * Builders and file names live in `lib/hgab-csv.ts`; the project columns are
 * the Projects export's (`projectCsvColumns`), so every file that lists project
 * rows reads the same way.
 *
 * Menu button pattern (WAI-ARIA): the button has `aria-haspopup="menu"` and
 * `aria-expanded`; opening it (click, Enter, Space, ArrowDown, ArrowUp) moves
 * focus into the menu; ArrowUp/ArrowDown/Home/End move between items, Escape
 * closes and returns focus to the button, Tab closes, and a press outside
 * closes. Works the same with touch.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { runQuery } from '../lib/duckdb';
import { downloadCsv } from '../lib/csv';
import { dataUrl } from '../lib/data-url';
import {
  BRIDGE_ORDER, HGAB_BASE, loadHgabMap, pdfUrl, projectsParquetUrl,
  type DatasetKey, type HgabDatasetMap, type HgabDatasetSummary, type HgabDocument,
} from '../lib/hgab';
import {
  coerceRow, defaultSort, exportSql, filtersFromParams, hasActiveFilters, idRegionSql, projectsCsv,
  type ProjectFilters,
} from '../lib/hgab-query';
import {
  changeSummaryCsv, changesRowCount, csvFileName, dimsCsv, dimsRowCount, documentsCsv, largestChangesCsv,
  mapPointsCsv, newAtThirdCsv, programDocuments, programTotalsCsv, projectRowCount, readingStatusCsv, regionsCsv,
  regionsRowCount,
} from '../lib/hgab-csv';
import type { HubView } from '../lib/hgab-ui';

/** The one line every download carries. */
const NOTE = 'Amounts are exact pesos as published. Matches are candidates, not findings.';

interface CsvItem {
  id: string;
  label: string;
  file: string;
  /** Needs DuckDB-Wasm (the parquet): shows "Preparing…" while it runs. */
  slow?: boolean;
  /** Shown instead of being chosen, e.g. while a count or a file is still loading. */
  disabled?: boolean;
  build: () => string | Promise<string>;
}

const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;

/** Absolute address: DuckDB and a CSV cell both need one; the dev data tree is served from the page's origin. */
function absolute(u: string): string {
  return /^https?:/.test(u) ? u : `${window.location.origin}${u}`;
}

async function queryProjectsCsv(key: DatasetKey, filters: ProjectFilters): Promise<string> {
  const res = await runQuery(exportSql(projectsParquetUrl(key), filters));
  return projectsCsv(res.rows.map((r) => coerceRow(r as Record<string, unknown>)), key);
}

/** Project id → the region its row lists; one small query per program, kept for the session. */
const regionLookups = new Map<DatasetKey, Promise<Map<string, string | null>>>();
function regionLookup(key: DatasetKey): Promise<Map<string, string | null>> {
  let p = regionLookups.get(key);
  if (!p) {
    p = runQuery(idRegionSql(projectsParquetUrl(key))).then((res) => new Map(
      res.rows.map((r) => {
        const row = r as { id: unknown; region: unknown };
        return [String(row.id), row.region == null ? null : String(row.region)] as const;
      }),
    ));
    regionLookups.set(key, p);
    p.catch(() => regionLookups.delete(key));
  }
  return p;
}

export default function HgabDownloads({
  summary,
  docs,
  view,
  projectsTotal,
  tone = 'light',
}: {
  summary: HgabDatasetSummary;
  docs: readonly HgabDocument[];
  view: HubView;
  /** Rows the Projects view currently shows (null while it counts). */
  projectsTotal: number | null;
  /** `dark` on the overview's navy band. */
  tone?: 'light' | 'dark';
}) {
  const d = summary.dataset;
  const key = d.key;
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const btnId = useId();
  const menuId = useId();
  const noteId = useId();

  // The map's own file, only on the Map view (the view loads the same cached file).
  const [mapState, setMapState] = useState<{ key: DatasetKey; map: HgabDatasetMap | null; err: boolean } | null>(null);
  useEffect(() => {
    if (view !== 'map') return;
    let live = true;
    loadHgabMap(key)
      .then((map) => { if (live) setMapState({ key, map, err: false }); })
      .catch(() => { if (live) setMapState({ key, map: null, err: true }); });
    return () => { live = false; };
  }, [view, key]);
  const map = mapState?.key === key ? mapState.map : null;
  const mapFailed = mapState?.key === key && mapState.err;

  const items = useMemo<CsvItem[]>(() => {
    const sortDefault = defaultSort(d);
    const total = projectRowCount(d);
    const out: CsvItem[] = [{
      id: 'all-projects',
      label: `All projects (${rows(total)})`,
      file: csvFileName(key, 'projects'),
      slow: true,
      build: () => queryProjectsCsv(key, filtersFromParams(new URLSearchParams(), sortDefault)),
    }];
    switch (view) {
      case 'overview':
        out.push({
          id: 'program-totals',
          label: `This view: published totals (${rows(summary.controls.length)})`,
          file: csvFileName(key, 'program-totals'),
          build: () => programTotalsCsv(summary.controls, d, docs),
        }, {
          id: 'change-summary',
          label: `This view: change summary (${rows(BRIDGE_ORDER.length)})`,
          file: csvFileName(key, 'change-summary'),
          build: () => changeSummaryCsv(d),
        });
        if (dimsRowCount(summary) > 0) {
          out.push({
            id: 'amounts-by-label',
            label: `This view: amounts by label (${rows(dimsRowCount(summary))})`,
            file: csvFileName(key, 'amounts-by-label'),
            build: () => dimsCsv(summary),
          });
        }
        break;
      case 'projects': {
        const filters = filtersFromParams(params, sortDefault);
        const filtered = hasActiveFilters(filters);
        out.push({
          id: 'projects-filtered',
          label: `This view: projects as filtered (${projectsTotal == null ? 'counting…' : rows(projectsTotal)})`,
          file: csvFileName(key, filtered ? 'projects-filtered' : 'projects'),
          slow: true,
          disabled: !projectsTotal,
          build: () => queryProjectsCsv(key, filters),
        });
        break;
      }
      case 'changes':
        out.push({
          id: 'largest-changes',
          label: `This view: largest changes (${rows(changesRowCount(summary))})`,
          file: csvFileName(key, 'largest-changes'),
          build: () => largestChangesCsv(summary),
        });
        break;
      case 'map': {
        if (!map) {
          out.push({
            id: 'regions',
            label: `This view: regions (${mapFailed ? 'not available' : 'loading…'})`,
            file: csvFileName(key, 'regions'),
            disabled: true,
            build: () => '',
          });
          break;
        }
        const hasPoints = map.points.length > 0;
        out.push({
          id: 'regions',
          // NIA's lists give no region: its one row is the amounts listed with none.
          label: map.regions.length
            ? `This view: regions (${rows(regionsRowCount(map))})`
            : `This view: amounts with no region (${rows(regionsRowCount(map))})`,
          file: csvFileName(key, 'regions'),
          slow: hasPoints,
          build: async () => regionsCsv(map, hasPoints ? await regionLookup(key) : null),
        });
        if (hasPoints) {
          out.push({
            id: 'map-points',
            label: `This view: mapped projects (${map.points.length.toLocaleString()} ${map.points.length === 1 ? 'point' : 'points'})`,
            file: csvFileName(key, 'map-points'),
            slow: true,
            build: async () => mapPointsCsv(map, await regionLookup(key)),
          });
        }
        break;
      }
      case 'readings': {
        const r = summary.readings;
        if (!r) break;
        out.push({
          id: 'reading-status',
          label: `This view: rows by what happened (${rows(Object.keys(r.status_counts).length)})`,
          file: csvFileName(key, 'reading-status'),
          build: () => readingStatusCsv(r),
        }, {
          id: 'reading-changed-totals',
          label: `This view: program lines whose total changed (${rows(r.changed_controls.length)})`,
          file: csvFileName(key, 'reading-changed-totals'),
          build: () => programTotalsCsv(r.changed_controls, d, docs),
        }, {
          id: 'reading-new-at-third',
          label: `This view: new at third reading (${rows(r.third_only.length)})`,
          file: csvFileName(key, 'reading-new-at-third'),
          build: () => newAtThirdCsv(r, key),
        });
        break;
      }
      case 'documents':
        out.push({
          id: 'documents',
          label: `This view: documents (${rows(programDocuments(d, docs).length)})`,
          file: csvFileName(key, 'documents'),
          build: () => documentsCsv(d, docs, (k) => absolute(pdfUrl(k))),
        });
        break;
    }
    return out;
  }, [d, key, view, summary, docs, params, projectsTotal, map, mapFailed]);

  const raw = useMemo(() => [
    { id: 'raw-parquet', href: dataUrl(`${HGAB_BASE}/${key}/projects.parquet`), name: 'projects.parquet', what: 'Every project row (Parquet)' },
    { id: 'raw-summary', href: dataUrl(`${HGAB_BASE}/${key}/summary.json`), name: 'summary.json', what: 'Totals and lists behind these pages (JSON)' },
  ], [key]);

  const menuItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
    [],
  );

  const close = useCallback((refocus: boolean) => {
    openRef.current = false;
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const show = useCallback((focus: 'first' | 'last') => {
    focusOnOpen.current = focus;
    openRef.current = true;
    setError(null);
    setOpen(true);
  }, []);

  // Move focus into the menu once it is drawn.
  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    (focusOnOpen.current === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open, menuItems]);

  // A press outside closes the menu (touch and mouse alike).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  function onButtonKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show(e.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (j: number) => { e.preventDefault(); list[(j + list.length) % list.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': go(i + 1); break;
      case 'ArrowUp': go(i < 0 ? list.length - 1 : i - 1); break;
      case 'Home': go(0); break;
      case 'End': go(list.length - 1); break;
      case 'Escape': e.preventDefault(); close(true); break;
      case 'Tab': close(false); break;
      default: break;
    }
  }

  async function choose(item: CsvItem) {
    if (busy || item.disabled) return;
    setError(null);
    if (!item.slow) {
      downloadCsv(item.file, await item.build(), { excelBom: true });
      close(true);
      return;
    }
    setBusy(item.id);
    try {
      const csv = await item.build();
      downloadCsv(item.file, csv, { excelBom: true });
      if (openRef.current) close(true);
    } catch (e) {
      setError(`This file could not be prepared (${String((e as Error)?.message || e)}). Try again, or use the raw files below.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`hgab-dl ${tone === 'dark' ? 'is-dark' : ''} ${open ? 'is-open' : ''}`.trim()} ref={wrapRef}>
      <button
        ref={btnRef}
        id={btnId}
        type="button"
        className="hgab-dl-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={busy ? true : undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        {busy ? 'Preparing…' : 'Download CSV'}
        <span className="hgab-dl-caret" aria-hidden="true">▾</span>
      </button>
      <div className="hgab-dl-panel" hidden={!open}>
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={btnId}
          aria-describedby={noteId}
          className="hgab-dl-menu"
          onKeyDown={onMenuKey}
        >
          {items.map((it, i) => (
            <div key={it.id} role="none" className={i === 1 ? 'hgab-dl-sep' : undefined}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="hgab-dl-item"
                aria-disabled={it.disabled || (busy != null && busy !== it.id) ? true : undefined}
                aria-busy={busy === it.id ? true : undefined}
                data-file={it.file}
                onClick={() => { void choose(it); }}
              >
                <span>{it.label}</span>
                {busy === it.id && <span className="hgab-dl-busy">Preparing…</span>}
              </button>
            </div>
          ))}
          <div role="group" aria-label="For analysts: raw files" className="hgab-dl-sep">
            <p className="hgab-dl-head" aria-hidden="true">For analysts: raw files</p>
            {raw.map((f) => (
              <a key={f.id} role="menuitem" tabIndex={-1} className="hgab-dl-item is-raw" href={f.href} download={f.name} target="_blank" rel="noopener">
                <span><code>{f.name}</code> <small>{f.what}</small></span>
              </a>
            ))}
          </div>
        </div>
        {error && <p className="hgab-dl-error" role="alert">{error}</p>}
        <p className="hgab-dl-note" id={noteId}>{NOTE}</p>
      </div>
    </div>
  );
}
