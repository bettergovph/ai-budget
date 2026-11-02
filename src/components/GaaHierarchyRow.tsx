import type { BaseEntity } from '../lib/types';
import * as fmt from '../lib/format';
export default function GaaHierarchyRow({
  rec,
  year,
  max,
  total,
  prevYear,
  drillable,
  onClick,
  code,
  comparable = true,
}: {
  rec: BaseEntity;
  year: number;
  max: number;
  total: number;
  prevYear: number | null;
  drillable: boolean;
  onClick: () => void;
  code?: string;
  comparable?: boolean;
}) {
  const v = rec.years[year]?.amount || 0;
  const prev = prevYear != null ? rec.years[prevYear]?.amount || 0 : null;
  const d = prev ? (v - prev) / prev : null;
  const isNew = prevYear != null && !prev && v > 0;
  const share = total ? v / total : 0;

  return (
    <tr
      className={drillable ? '' : 'disabled'}
      onClick={drillable ? onClick : undefined}
    >
      <td className="name">
        <span>
          {drillable ? (
            <button
              type="button"
              className="gaa-row-link"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              {rec.description}
            </button>
          ) : (
            rec.description
          )}
        </span>
        {code && <span className="desc">{code}</span>}
      </td>
      <td className="bar-cell">
        <div className="bar-h accent">
          <span style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
        </div>
      </td>
      <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
      <td className="num">
        <span className="delta">{fmt.pct(share, share >= 0.1 ? 1 : 2)}</span>
      </td>
      <td className="num">
        {!comparable ? (
          <span
            className="delta"
            title="Historical coverage and classifications are not directly comparable"
          >
            —
          </span>
        ) : isNew ? (
          <span className="delta up">new</span>
        ) : d == null ? (
          <span className="delta">—</span>
        ) : (
          <span className={`delta ${d > 0 ? 'up' : 'down'}`}>
            {fmt.signedPct(d, 0)}
          </span>
        )}
      </td>
      <td className="chev">{drillable ? '›' : ''}</td>
    </tr>
  );
}
