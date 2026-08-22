/**
 * `/2027/methodology` — how the raw DBM extract became this microsite.
 *
 * Kept as a page rather than a doc file because the analysts using the site
 * are the people who need to defend the numbers; the field mapping and the two
 * structural corrections have to be one click from any figure.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { NepHeader } from '../components/Nep2027Bits';
import * as fmt from '../lib/format';
import { BASE_YEAR, NEP_YEAR, loadNepIndex, type NepNationalIndex } from '../lib/nep2027';
import '../nep2027.css';

const FIELD_MAP: Array<[string, string, string]> = [
  ['SORDER', 'sorder', 'Section: 1 = agency budgets, 2 = special purpose funds and automatic appropriations.'],
  ['DEPARTMENT', 'department', 'Two-digit department code. Not unique on its own — see the correction below.'],
  ['UACS_DPT_DSC', 'uacs_dpt_dsc', 'Department name.'],
  ['AGENCY', 'agency', 'Three-digit agency code, unique within a department.'],
  ['UACS_AGY_DSC', 'uacs_agy_dsc', 'Agency name.'],
  ['PREXC_FPAP_ID', 'prexc_fpap_id', '15-digit hierarchical programme / activity / project code.'],
  ['PREXC_LEVEL', 'prexc_level', '1–6 are hierarchy headers; 7 is the leaf activity that carries line items.'],
  ['DSC', 'dsc', 'P/A/P description at whatever level the row sits.'],
  ['UACS_OPERDIV_ID', 'uacs_operdiv_id', 'Sub-unit code — schools divisions for DepEd, blank for most groups.'],
  ['UACS_DIV_DSC', 'uacs_div_dsc', 'Sub-unit name.'],
  ['OPERUNIT', 'operunit', 'Seven-digit operating (implementing) unit code.'],
  ['UACS_OPER_DSC', 'uacs_oper_dsc', 'Operating unit name.'],
  ['UACS_REG_ID', 'uacs_reg_id', 'Two-digit region code; 00 is central office / nationwide.'],
  ['UACS_REG_DSC', '— (not in the GAA extracts)', 'Region name. New in this file; used to backfill names for FY2026 too.'],
  ['FUNDCD', 'fundcd', 'Eight-digit fund subcategory code.'],
  ['UACS_FUNDSUBCAT_DSC', 'uacs_fundsubcat_dsc', 'Fund subcategory name.'],
  ['UACS_EXP_CD', 'uacs_exp_cd', '1 personnel services, 2 MOOE, 3 financial expenses, 6 capital outlays.'],
  ['UACS_EXP_DSC', 'uacs_exp_dsc', 'Expense class name.'],
  ['UACS_OBJ_CD', 'uacs_sobj_cd', 'Ten-digit object code. The only real rename between the two files.'],
  ['UACS_OBJ_DSC', 'uacs_sobj_dsc', 'Object name. Renamed the same way.'],
  ['AMT', 'amt', 'Thousands of pesos, comma-grouped and quoted. Blank on hierarchy header rows.'],
];

export default function Nep2027Methodology() {
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);
  useEffect(() => { loadNepIndex().then(setIdx).catch(() => { /* page reads fine without it */ }); }, []);

  return (
    <>
      <NepHeader crumb="Methodology" />
      <main className="nep-main nep-prose">
        <div className="page-headline">
          <p className="page-eyebrow">Methodology</p>
          <h1 className="page-title">How this FY{NEP_YEAR} dataset was built</h1>
          <p className="page-dek">
            One CSV from DBM, one deterministic import, and a FY{BASE_YEAR} baseline drawn from the GAA
            extracts already in this repository.
          </p>
        </div>

        <section className="nep-section">
          <SectionHead eyebrow="Provenance" headline="Source and reconciliation" />
          <table className="nep-table nep-kv">
            <tbody>
              <tr><th>Source file</th><td><code>NEP-FY2027.csv</code> (233 MB, 756,629 data rows)</td></tr>
              <tr><th>Rows kept</th><td>756,627 — two trailing all-blank rows are dropped</td></tr>
              <tr><th>Money-bearing line items</th><td>{idx ? idx.national.line_items.toLocaleString() : '532,313'} (rows carrying an object code)</td></tr>
              <tr><th>FY{NEP_YEAR} NEP total</th><td>{idx ? fmt.php(idx.national.amount, { unit: 'full' }) : '₱7,200,186,000,000'}</td></tr>
              <tr><th>FY{BASE_YEAR} GAA baseline</th><td>{idx ? fmt.php(idx.national.base_amount, { unit: 'full' }) : '₱6,793,162,000,000'}</td></tr>
              <tr><th>Units</th><td>Source amounts are thousands of pesos; the site multiplies by 1,000 and displays full pesos</td></tr>
              <tr><th>Rebuild</th><td><code>npm run import:nep2027</code></td></tr>
            </tbody>
          </table>
          <p>
            The department totals sum exactly to the national total, and each group's expense-class rows sum
            exactly to that group's total — both are asserted by <code>npm run verify:nep2027</code>.
          </p>
        </section>

        <section className="nep-section">
          <SectionHead
            eyebrow="Field mapping"
            headline="NEP columns against the GAA extract columns"
            dek="The two files are the same table. Only the object-code columns are named differently, and the NEP adds a region name."
          />
          <div className="nep-table-wrap">
            <table className="nep-table nep-map-table">
              <thead>
                <tr><th>NEP FY{NEP_YEAR}</th><th>GAA extract</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {FIELD_MAP.map(([a, b, note]) => (
                  <tr key={a}>
                    <td><code>{a}</code></td>
                    <td><code>{b}</code></td>
                    <td className="nep-td-dim">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Formatting differs where the content does not: the NEP quotes amounts with thousands separators
            and leaves missing cells empty, while the GAA extracts carry floats and the literal string
            <code> nan</code>. Both are normalised to null on import.
          </p>
        </section>

        <section className="nep-section">
          <SectionHead
            eyebrow="Corrections"
            headline="Two places this dataset deliberately differs from the legacy tree"
          />
          <ol className="nep-numbered">
            <li>
              <strong>Special purpose funds and automatic appropriations get their own groups.</strong>{' '}
              Rows with <code>SORDER = 2</code> reuse department codes 01 and 04, which already belong to
              Congress and the Department of Agrarian Reform. Filing them by department code would put
              ₱2.58 T of automatic appropriations inside DAR's ₱17 B and ₱448 B of special purpose funds
              inside Congress's ₱28 B. Here they become groups <code>AUTO</code> and <code>SPF</code>, and the
              FY{BASE_YEAR} baseline is split the same way so the comparison stays honest. The department
              tables mark them <span className="pill nep-pill">derived</span>.
            </li>
            <li>
              <strong>Hierarchy headers are not line items.</strong> 224,314 rows carry a P/A/P description
              and level but no object code, fund or amount — they are the programme tree, not money. They
              populate the programme hierarchy and are excluded from every amount, rather than being counted
              as ₱0 line items the way the legacy tree counted them.
            </li>
          </ol>
        </section>

        <section className="nep-section">
          <SectionHead eyebrow="Derived fields" headline="Things the source does not state outright" />
          <ul className="nep-bullets">
            <li>
              <strong>Programme rollup.</strong> <code>PREXC_FPAP_ID</code> is positional: digit 1 is the
              major class, digits 1–2 the organisational outcome, 1–4 the programme, 1–6 the sub-programme,
              1–9 the project group, and all 15 the activity. Each line item is attributed to the nearest
              ancestor that actually exists as a header row in the same agency, walking 6 → 4 → 2 → 1 digits.
            </li>
            <li>
              <strong>Region names.</strong> The FY{BASE_YEAR} extracts carry region codes but no names, and
              the NEP leaves the name blank on its <code>SORDER = 2</code> rows. Names are backfilled from the
              code, and region <code>00</code> is labelled "Central Office (nationwide)".
            </li>
            <li>
              <strong>Percent change</strong> is shown as "new" where the FY{BASE_YEAR} baseline is zero,
              rather than as an infinite increase.
            </li>
          </ul>
        </section>

        <section className="nep-section">
          <SectionHead eyebrow="Caveats" headline="Read before citing" />
          <ul className="nep-bullets">
            <li>
              The NEP is a <strong>proposal</strong>. Congress amends it — sometimes heavily — before it is
              enacted as the GAA. Nothing here is an appropriation.
            </li>
            <li>
              Comparing FY{NEP_YEAR} NEP to FY{BASE_YEAR} GAA compares a proposal to an enacted law. That is
              the comparison analysts usually want, but it is not like-for-like; the FY{BASE_YEAR} NEP would
              be the like-for-like baseline.
            </li>
            <li>
              Programme and project codes are reassigned between years. A programme showing as "new" may be a
              renamed or restructured continuation, and a large reduction may be a transfer to another
              agency rather than a cut.
            </li>
            <li>
              Appropriations are legal authority to spend. They are not obligations, disbursements, or
              outcomes.
            </li>
            <li>
              Aggregation here is machine-generated. Verify any figure against the DBM source document
              before publication.
            </li>
          </ul>
        </section>

        <p className="nep-provenance">
          <Link to="/2027">Back to the FY{NEP_YEAR} overview</Link> · the FY2020–2026 GAA portal lives at{' '}
          <Link to="/gaa">/gaa</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
