/**
 * `/hgab/2027/review/how-to` — "How to review a project": the steps a new volunteer follows in the project reviewer,
 * each with a screenshot. The steps and their text are in src/lib/hgab-review-howto.ts, shared with the explainer video;
 * the screenshots come from `npm run build:hgab-review-howto`; the video (HOWTO_VIDEO) is in the campaign gallery.
 * Linked from the reviewer (its welcome panel, sign-in box and "How it works").
 */
import { Link } from 'react-router-dom';
import { DisclaimerNotice } from '../components/HgabBits';
import { REVIEW_ROOT } from '../lib/hgab-review';
import {
  HOWTO_SHOTS_TAKEN, HOWTO_SHOT_HEIGHT, HOWTO_SHOT_WIDTH, HOWTO_STEPS, HOWTO_TITLE, HOWTO_VIDEO, howtoShot,
} from '../lib/hgab-review-howto';
import '../hgab-review-howto.css';

const taken = new Date(`${HOWTO_SHOTS_TAKEN}T00:00:00+08:00`).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });

export default function HgabReviewHowto() {
  return (
    <div className="hw-app">
      <header className="hw-bar">
        <Link to="/" className="hw-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="hw-bar-title">
          <span>Project reviewer</span>
          <b>{HOWTO_TITLE}</b>
        </div>
        <Link to={REVIEW_ROOT} className="hw-btn is-primary">Open the reviewer</Link>
      </header>

      <div className="hw-layout">
        <nav className="hw-toc" aria-label="Steps">
          <p className="hw-toc-h">Steps</p>
          <ol>
            <li><a href="#video"><span>▶</span>Watch the video</a></li>
            {HOWTO_STEPS.map((s, i) => <li key={s.key}><a href={`#${s.key}`}><span>{i + 1}</span>{s.title}</a></li>)}
          </ol>
        </nav>

        <main className="hw-main">
          <section className="hw-intro">
            <div className="hw-intro-text">
            <h1>{HOWTO_TITLE}</h1>
            <p className="hw-lede">
              Volunteers read the documents of the DPWH projects in the FY2027 House bill and answer a few questions about each one.
              Here is how, step by step.
            </p>
            <ul className="hw-facts">
              <li><b>{HOWTO_STEPS.length} steps</b> from opening the reviewer to sending your review</li>
              <li><b>A sign-in with your email</b>, no password</li>
              <li><b>Works on a phone</b>; on a computer the documents open beside the project</li>
            </ul>
            <Link to={REVIEW_ROOT} className="hw-btn is-primary is-big">Start reviewing</Link>
            </div>
            <figure id="video" className="hw-video">
              <video src={HOWTO_VIDEO.src} poster={HOWTO_VIDEO.poster} controls preload="none" playsInline width={1920} height={1080}>
                <a href={HOWTO_VIDEO.src}>Download the video</a>
              </video>
              <figcaption>
                {HOWTO_VIDEO.label}. The same steps, with captions.{' '}
                <a href={HOWTO_VIDEO.gallery} target="_blank" rel="noopener noreferrer">Download or share it</a>
              </figcaption>
            </figure>
          </section>

          {HOWTO_STEPS.map((s, i) => (
            <section key={s.key} id={s.key} className="hw-step" aria-labelledby={`${s.key}-h`}>
              <div className="hw-step-text">
                <p className="hw-step-n">Step {i + 1} of {HOWTO_STEPS.length}</p>
                <h2 id={`${s.key}-h`}>{s.title}</h2>
                <p>{s.text.join(' ')}</p>
              </div>
              <figure className="hw-shot">
                <a href={howtoShot(s.key)} target="_blank" rel="noopener noreferrer" title="Open the full-size screenshot">
                  <img src={howtoShot(s.key)} alt={s.alt} width={HOWTO_SHOT_WIDTH} height={HOWTO_SHOT_HEIGHT} loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />
                </a>
              </figure>
            </section>
          ))}

          <section className="hw-good" aria-labelledby="good-h">
            <h2 id="good-h">Good to know</h2>
            <ul>
              <li><b>Keys:</b> <kbd>j</kbd> next project, <kbd>k</kbd> previous project, <kbd>[</kbd> and <kbd>]</kbd> previous and next document.</li>
              <li><b>A red flag is a reason to check, not a finding.</b> Write what the documents show, not what you suspect.</li>
              <li><b>A document can be matched to the wrong project.</b> If it is, say so in your remarks.</li>
              <li><b>Your review goes to the team.</b> Nothing of it is kept in your browser, so you can continue on another computer.</li>
              <li><b>Not sure?</b> Something unclear is Needs attention: say what is unclear, and the team follows up.</li>
            </ul>
            <p className="hw-muted">Screenshots taken {taken}, on a sample project. The answers in them are an example, not a real review.</p>
            <Link to={REVIEW_ROOT} className="hw-btn is-primary is-big">Start reviewing</Link>
          </section>

          <DisclaimerNotice compact className="hw-disclaimer" />
        </main>
      </div>
    </div>
  );
}
