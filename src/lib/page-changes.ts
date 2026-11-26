/**
 * Changes to figures readers have already seen, listed on the page they changed, newest first (AGENTS.md: "Never
 * change a published figure silently"). Rendered by src/components/PageChanges.tsx.
 */
export interface PageChange {
  /** The day the change went live (YYYY-MM-DD, Manila). */
  date: string;
  /** What changed, with a before-and-after example in pesos, and whether totals moved. */
  text: string;
}

/** "November 7, 2026", in Manila. */
export function longDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
}
