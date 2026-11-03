/**
 * `/citizen-reports` — budget analyses that citizens, journalists and civic
 * groups publish on their own sites, one card each (lib/citizen-reports.ts).
 * A card opens the site itself in a new tab; its screenshot is decoration,
 * its words are the site's own.
 *
 * Chrome follows Hearings: masthead, .page-headline, then a grid of cards.
 */
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  CITIZEN_REPORTS, SHOTS_TAKEN, SHOT_HEIGHT, SHOT_WIDTH, hostOf, shotPath,
} from '../lib/citizen-reports';
import { longDate } from '../lib/seo';
import '../nep2027.css';
import '../citizen-reports.css';

export default function CitizenReports() {
  return (
    <div className="cr-page">
      <SiteHeader crumb="Citizen Reports" />
      <main className="nep-main cr-main">
        <div className="page-headline">
          <p className="page-eyebrow">Budget analysis · {CITIZEN_REPORTS.length} sites</p>
          <h1 className="page-title">Citizen Reports</h1>
          <p className="page-dek">
            Analyses of the national budget by citizens, journalists and civic groups: department
            reviews, the House bill against the NEP, hearing digests and maps by district. Each
            site is its own work, with its own methods and caveats.
          </p>
        </div>

        <ul className="cr-grid">
          {CITIZEN_REPORTS.map((r) => (
            <li key={r.key}>
              <a className="cr-card" href={r.url} target="_blank" rel="noopener noreferrer">
                <div className="cr-shot">
                  <img
                    src={shotPath(r)}
                    alt=""
                    width={SHOT_WIDTH}
                    height={SHOT_HEIGHT}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="cr-body">
                  <p className="cr-covers">{r.covers}</p>
                  <h2 className="cr-title">{r.title}</h2>
                  {r.by && <p className="cr-by">By {r.by}</p>}
                  <p className="cr-summary">{r.summary}</p>
                  {r.note && <p className="cr-note">{r.note}</p>}
                  <span className="cr-host">
                    {hostOf(r.url)} <span aria-hidden="true">↗</span>
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>

        <p className="nep-provenance">
          Screenshots taken {longDate(SHOTS_TAKEN)}. Each site’s figures, methods and disclaimers
          are its own: check a figure against the published budget documents before you cite it.
        </p>
      </main>
      <SiteFooter source="SOURCES: THE SITES LINKED ABOVE" />
    </div>
  );
}
