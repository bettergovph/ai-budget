/**
 * A DPWH contract ID, linked to DPWH's own page for it on its transparency portal (a new tab), so a reader can check
 * our figures against the source. Used wherever a contract ID is listed: the contractor pages and the map.
 */
import { dpwhContractUrl } from '../lib/hgab-contractors';

export default function DpwhContractLink({ id, className }: { id: string; className?: string }) {
  return (
    <a
      className={className}
      style={{ whiteSpace: 'nowrap' }}
      href={dpwhContractUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Contract ${id} on DPWH’s transparency portal (opens a new tab)`}
    >
      {id}<span aria-hidden="true"> ↗</span><span className="visually-hidden"> (DPWH’s record, opens a new tab)</span>
    </a>
  );
}
