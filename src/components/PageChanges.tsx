/**
 * "Changes to this page": a page's dated corrections, newest first (src/lib/page-changes.ts). Lifted from the
 * Districts pages when the project reviewer and its report needed one too (2026-11-26).
 */
import { longDate, type PageChange } from '../lib/page-changes';

export function PageChanges({ changes, id = 'changes', className, title = 'Changes to this page' }: {
  changes: readonly PageChange[];
  id?: string;
  className: string;
  title?: string;
}) {
  if (!changes.length) return null;
  return (
    <section className={className} id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <ul>
        {changes.map((c) => (
          <li key={c.date + c.text.slice(0, 20)}>
            <time dateTime={c.date}>{longDate(c.date)}</time> {c.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
