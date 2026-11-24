/**
 * `/schools/about` — where the schools data comes from, how it was joined, and what it cannot tell (the data pack's
 * own rules, docs/schools-data.md), plus how field reports are handled.
 */
import { Link } from 'react-router-dom';
import { SchoolsChrome, SourcesList } from '../components/SchoolsBits';
import { NO_DATA_EXPLAINED, SCHOOLS_LIST, SCHOOLS_OVERVIEW } from '../lib/schools';

export default function SchoolsAbout() {
  return (
    <SchoolsChrome>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · about the data</p>
        <h1 className="page-title">Where the schools data comes from</h1>
        <p className="page-dek">DepEd’s datasets as submitted to EDCOM 2, joined by School ID: the school registry, the SY 2023–2024 classroom shortage, LIS enrollment and Project BUKAS facilities, 2022 coordinates, and the FY 2026 School Building Program Masterlist.</p>
      </div>
      <div className="sch-prose">
        <h2 className="sch-h2">What is in it</h2>
        <ul>
          <li><strong>The registry</strong> (school_types_consolidated): 60,204 schools, one row each, keyed by School ID.</li>
          <li><strong>Classroom shortage, SY 2023–2024</strong>: matched to 47,362 schools, by School ID (or, for 355, a unique new School ID).</li>
          <li><strong>Coordinates, 2022</strong>: 47,828 schools (LIS first, then NSBI). Seven points fall outside the Philippines and are left off the map.</li>
          <li><strong>Facilities, SY 2023–2024</strong> (59,101 schools) and <strong>enrollment and classrooms, SY 2023–2024</strong> (47,449 schools).</li>
          <li><strong>DPWH contracts, 2016 to 2026</strong>: each school’s project history. Of 33,275 school contracts, 26,802 name a school by its School ID or by its name in the same province, and are linked to 16,985 schools. Matches by location alone are shown apart, as possible matches. DPWH’s list doesn’t include classrooms built by DepEd or local governments.</li>
          <li><strong>The FY 2026 School Building Program Masterlist</strong>: 5,652 projects. 5,560 are linked to a school by its ID, and 92 are left for review.</li>
        </ul>
        <p>The <Link to={SCHOOLS_OVERVIEW}>overview</Link> reads all of it against DepEd’s school-building budget and PSA’s figures on poverty and children.</p>
        <h2 className="sch-h2">How to read it</h2>
        <ul>
          <li><strong>No data is not zero.</strong> A school that no source row matched shows “No data”. A zero means the source reported zero. {NO_DATA_EXPLAINED}</li>
          <li><strong>EDCOM 2’s terms.</strong> Shortage levels follow the Classroom Shortage Rate, shortage ÷ (available classrooms + shortage) × 100: Moderate up to 20%, Severe more than 20% to 50%, Extreme more than 50%. The number of classrooms short is always shown beside it. A school is underallocated, fully allocated or overallocated against its recorded shortage; “excess allocated classrooms” are those beyond a school’s recorded need, including all allocated to schools with no recorded shortage.</li>
          <li><strong>Matches are by ID only.</strong> Similar names or towns are kept as suggestions for review. They never fill in a school’s figures. Each school page says how it was matched.</li>
          <li><strong>A listed classroom is planned, not built.</strong> The 2026 classrooms and budgets are the list’s own figures. They do not show that money was released, a contract awarded or a room finished. The 1,274 PSIP III projects are “for bidding”, with no amount and an expected start of March 2027.</li>
          <li><strong>The years differ.</strong> The shortage and enrollment are for SY 2023–2024, the coordinates from 2022 and the allocations FY 2026. A school may have changed since.</li>
          <li><strong>Some projects belong to no school here.</strong> 151 linked projects use a School ID that is in the shortage list but not in the registry, so the area totals leave them out.</li>
          <li><strong>Shortage figures are DepEd’s.</strong> They are often fractional, and we round them to whole classrooms for display.</li>
        </ul>
        <h2 className="sch-h2">Sources</h2>
        <SourcesList />
        <h2 className="sch-h2">Field reports</h2>
        <p>
          Anyone who knows a school can sign in (email code, no password) and send one report on it, then change it at any time.
          The form follows EDCOM 2’s School Feedback Form: whether the school needs more classrooms (and why, and about how
          many), whether it does not, whether there is space to build, and the status of its projects; plus when it was last
          seen and the reporter’s relationship to the school. Details are required when a report differs from the records.
          Pages show only counts; names and emails are seen only by the review team. Every version of a report is kept, and
          reports are reviewed and validated before any figure changes.
        </p>
        <p><Link to={`${SCHOOLS_LIST}?status=under`}>Find a school to report on →</Link></p>
      </div>
    </SchoolsChrome>
  );
}
