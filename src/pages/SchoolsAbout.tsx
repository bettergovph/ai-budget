/**
 * `/schools/about` — where the schools data comes from, how it was joined, and what it cannot tell (the data pack's
 * own rules, docs/schools-data.md), plus how field reports are handled.
 */
import { Link } from 'react-router-dom';
import { SchoolsChrome } from '../components/SchoolsBits';
import { SCHOOLS_LIST } from '../lib/schools';

export default function SchoolsAbout() {
  return (
    <SchoolsChrome>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · about the data</p>
        <h1 className="page-title">Where the schools data comes from</h1>
        <p className="page-dek">A data pack joining DepEd’s school registry with its 2023 classroom shortages, 2022 coordinates, 2023 facilities and enrolment, and the 2026 School Building Program list.</p>
      </div>
      <div className="sch-prose">
        <h2 className="sch-h2">What is in it</h2>
        <ul>
          <li><strong>The registry</strong> (school_types_consolidated): 60,204 schools, one row each, keyed by School ID.</li>
          <li><strong>Classroom shortages, 2023</strong>: matched to 47,362 schools, by School ID (or, for 355, a unique new School ID).</li>
          <li><strong>Coordinates, 2022</strong>: 47,828 schools (LIS first, then NSBI). Seven points fall outside the Philippines and are left off the map.</li>
          <li><strong>Facilities, 2023</strong> (59,101 schools) and <strong>enrolment and classrooms, 2023</strong> (47,449 schools).</li>
          <li><strong>DPWH contracts, 2016 to 2026</strong>: each school’s project history. Of 33,275 school contracts, 26,802 name a school by its School ID or by its name in the same province, and are linked to 16,985 schools. Matches by location alone are shown apart, as possible matches. DPWH’s list doesn’t include classrooms built by DepEd or local governments.</li>
          <li><strong>The 2026 School Building Program list</strong>: 5,652 projects. 5,560 are linked to a school by its ID, and 92 are left for review.</li>
        </ul>
        <h2 className="sch-h2">How to read it</h2>
        <ul>
          <li><strong>No data is not zero.</strong> A school that no source row matched shows “No data”. A zero means the source reported zero.</li>
          <li><strong>Matches are by ID only.</strong> Similar names or towns are kept as suggestions for review. They never fill in a school’s figures. Each school page says how it was matched.</li>
          <li><strong>A listed classroom is planned, not built.</strong> The 2026 classrooms and budgets are the list’s own figures. They do not show that money was released, a contract awarded or a room finished. The 1,274 PSIP III projects are “for bidding”, with no amount and an expected start of March 2027.</li>
          <li><strong>The years differ.</strong> The shortages and enrolment are from 2023, the coordinates from 2022 and the projects from 2026. A school may have changed since.</li>
          <li><strong>Some projects belong to no school here.</strong> 151 linked projects use a School ID that is in the shortage list but not in the registry, so the area totals leave them out.</li>
          <li><strong>Shortage figures are DepEd’s.</strong> They are often fractional, and we round them to whole classrooms for display.</li>
        </ul>
        <h2 className="sch-h2">Field reports</h2>
        <p>
          Anyone who knows a school can sign in (email code, no password) and send one report on it, which they can change at
          any time. It takes under a minute: is the school here and open; does it lack classrooms, and if so about how many
          more it needs and what shows it (shifts, makeshift rooms, shared rooms, unsafe rooms); what they have seen of its
          2026 projects; and how they know the school. Pages show only counts, never names or emails. Every version of a
          report is kept, and the reports go to DepEd and EDCOM2 as structured feedback on the list.
        </p>
        <p><Link to={`${SCHOOLS_LIST}?shortage=short`}>Find a school to report on →</Link></p>
      </div>
    </SchoolsChrome>
  );
}
