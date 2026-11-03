/**
 * Formatting and download helpers shared by the page by party (`/hgab/2027/parties`) and each party's page
 * (`/hgab/2027/parties/:party`). Browser-only (it builds downloads); the data contract is lib/hgab-parties.ts.
 */
import * as fmt from './format';
import { billions, count } from './hgab-history-view';

/** "33.5%"; "—" when there is nothing to divide by. */
export const pct = (part: number, whole: number, digits = 1) => (whole ? `${((part / whole) * 100).toFixed(digits)}%` : '—');
/** "₱21.4B", "₱705.0M", "₱0", "—" for table cells. */
export const short = (v: number | null | undefined) => (v == null ? '—' : v === 0 ? '₱0' : `₱${fmt.shortPhp(v)}`);
/** "₱2.06 trillion", "₱64.0 billion", "₱284 million" for sentences. */
export const amount = (v: number) => (v >= 1e12 ? `₱${(v / 1e12).toFixed(2)} trillion` : billions(v));
export const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** Save text as a UTF-8 CSV (with a byte-order mark, so spreadsheet apps read the peso sign). */
export function downloadCsv(name: string, text: string): void {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
