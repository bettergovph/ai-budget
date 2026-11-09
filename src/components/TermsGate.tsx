import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CONTACT_EMAIL, DISCLAIMER_PAGE, DISCORD_URL, ISSUES_URL, LEGAL_EFFECTIVE, LEGAL_PAGES, TERMS_PAGE, TERMS_STORAGE_KEY,
  TERMS_VERSION,
} from '../lib/site-legal';
import '../terms-gate.css';

/**
 * The first-visit agreement. Until a visitor ticks "I have read and agree" and selects "I agree", every page sits behind
 * a modal they can't dismiss; "I do not agree" closes the site. The acceptance (TERMS_VERSION and the time) is kept in
 * localStorage only; nothing is sent to the server. Bumping TERMS_VERSION asks everyone again.
 *
 * The modal ends with an invitation to review the site (Jason, 2026-11-08: "It's still human reviewed and ai-assisted.
 * Put it at the bottom. There should be call to action as well"), so AI is mentioned there, not among the points.
 *
 * The Terms of Service and Disclaimer pages show the same agreement as a bar under the page instead, so a visitor who
 * opens them from the modal (in a new tab) can read them first. Accepting in any tab closes the agreement in the others.
 */

/** The points a visitor accepts, in plain words; the Terms of Service and the Disclaimer say each in full. */
const POINTS: readonly { lead: string; body: string }[] = [
  {
    lead: 'Not a government website.',
    body: 'The People’s Budget Coalition and BetterGov.ph are independent. We are not part of, and do not speak for, any government agency, Congress, party or official.',
  },
  {
    lead: 'Check before you rely on it.',
    body: 'Figures, matches and summaries can be wrong, incomplete or out of date. Verify any figure against the official documents linked on each page before you cite it, share it or act on it.',
  },
  {
    lead: 'No accusations.',
    body: 'Nothing here accuses any person, office, party or contractor of wrongdoing. An insertion, a change, a red flag, a ranking or a total is a question to ask, not evidence of wrongdoing. The documents do not say who asked for any project.',
  },
  {
    lead: 'Budgets, not spending.',
    body: 'Amounts are what the budget documents set aside, not what was spent.',
  },
  {
    lead: 'Information only, as is.',
    body: 'It is not legal, financial or other professional advice. We give no warranty, and as far as the law allows, we are not liable for any loss from using the site.',
  },
  {
    lead: 'You answer for how you use it.',
    body: 'Quote figures with their source and date, and share posters whole. Never present our work as official, or use it to harass, threaten or defame anyone.',
  },
];

// Dev server only (Vite drops this from production builds): `?reset-terms` forgets the acceptance, to review the
// agreement again. Clearing cookies alone does not clear localStorage.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('reset-terms')) {
  try {
    localStorage.removeItem(TERMS_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing saved to forget.
  }
}

function hasAccepted(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(TERMS_STORAGE_KEY) ?? 'null') as { version?: string } | null;
    return saved?.version === TERMS_VERSION;
  } catch {
    return false;
  }
}

function saveAcceptance() {
  try {
    localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify({ version: TERMS_VERSION, acceptedAt: new Date().toISOString() }));
  } catch {
    // Storage blocked (some private modes): accepted for this visit only.
  }
}

/**
 * "The site closes." Scripts may only close tabs they opened, so when the browser refuses, the page is replaced with a
 * blank one; Back then returns to wherever the visitor came from.
 */
function leaveSite() {
  window.close();
  window.setTimeout(() => window.location.replace('about:blank'), 100);
}

export default function TermsGate() {
  const { pathname } = useLocation();
  const [accepted, setAccepted] = useState(hasAccepted);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TERMS_STORAGE_KEY || e.key === null) setAccepted(hasAccepted());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (accepted) return null;
  const accept = () => {
    saveAcceptance();
    setAccepted(true);
  };
  const onLegalPage = LEGAL_PAGES.includes(pathname.replace(/\/+$/, ''));
  return onLegalPage ? <TermsBar onAccept={accept} /> : <TermsModal onAccept={accept} />;
}

function TermsModal({ onAccept }: { onAccept: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // Start at the heading, so a screen reader reads the terms before the buttons.
    title.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = overflow;
      if (d.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="tg-modal"
      aria-labelledby="tg-title"
      aria-describedby="tg-intro"
      // Escape must not dismiss it; browsers that close it anyway (a second Escape) get it straight back.
      onCancel={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}
      onClose={() => { const d = dialog.current; if (d && !done.current && !d.open) d.showModal(); }}
    >
      <div className="tg-body">
        <p className="tg-eyebrow">Please read before you continue</p>
        <h2 id="tg-title" className="tg-title" ref={title} tabIndex={-1}>
          An independent reading of the national budget
        </h2>
        <p id="tg-intro" className="tg-intro">
          BetterGov Budget is a project of the People’s Budget Coalition and BetterGov.ph. To use it, you must accept
          these terms.
        </p>
        <Points />
        <ReviewInvite />
      </div>
      <Agreement onAccept={() => { done.current = true; onAccept(); }} newTab />
    </dialog>
  );
}

function TermsBar({ onAccept }: { onAccept: () => void }) {
  return (
    <aside className="tg-bar" aria-labelledby="tg-bar-title">
      <div className="tg-bar-inner">
        <p className="tg-bar-lead">
          <strong id="tg-bar-title">To use BetterGov Budget, accept these terms.</strong> Read this page, then confirm
          below. Until you do, the rest of the site stays closed.
        </p>
        <Agreement onAccept={onAccept} />
      </div>
    </aside>
  );
}

function Points() {
  return (
    <ul className="tg-points">
      {POINTS.map((p) => (
        <li key={p.lead}><strong>{p.lead}</strong> {p.body}</li>
      ))}
    </ul>
  );
}

/** The call to action, last in the modal: how the site is made, and an invitation to help check it. */
function ReviewInvite() {
  return (
    <section className="tg-invite" aria-labelledby="tg-invite-title">
      <h3 id="tg-invite-title" className="tg-invite-title">Be a citizen budget reviewer</h3>
      <p>
        BetterGov Budget is AI-assisted and reviewed by people, and we want more reviewers. Check the lines for your
        region, office or department against the official documents, and tell us what you find.
      </p>
      <p className="tg-invite-actions">
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Join the reviewers on Discord ↗</a>
        <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">Report an error ↗</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </section>
  );
}

/** The checkbox and the two buttons. `newTab`: in the modal, the terms open in a new tab so the agreement stays put. */
function Agreement({ onAccept, newTab = false }: { onAccept: () => void; newTab?: boolean }) {
  const [checked, setChecked] = useState(false);
  const [missing, setMissing] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!checked) {
      setMissing(true);
      box.current?.focus();
      return;
    }
    onAccept();
  };

  const doc = (to: string, label: string) =>
    newTab
      ? <a href={to} target="_blank" rel="noopener">{label}</a>
      : <Link to={to}>{label}</Link>;

  return (
    <form className="tg-form" onSubmit={submit} noValidate>
      <label className="tg-check">
        <input
          ref={box}
          type="checkbox"
          checked={checked}
          onChange={(e) => { setChecked(e.target.checked); setMissing(false); }}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? errorId : undefined}
        />
        <span>
          I have read and agree to the {doc(TERMS_PAGE, 'Terms of Service')} and the {doc(DISCLAIMER_PAGE, 'Disclaimer')}.
        </span>
      </label>
      {missing && (
        <p id={errorId} className="tg-error" role="alert">
          Tick the box to confirm that you have read and agree to the terms.
        </p>
      )}
      <div className="tg-actions">
        <button type="submit" className="tg-btn is-primary">I agree</button>
        <button type="button" className="tg-btn" onClick={leaveSite}>I do not agree</button>
      </div>
      <p className="tg-fine">
        If you do not agree, the site closes. Your choice is saved in this browser only; nothing is sent to us. Terms
        effective {LEGAL_EFFECTIVE}.
      </p>
    </form>
  );
}
