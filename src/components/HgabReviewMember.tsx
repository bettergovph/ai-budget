/**
 * Clerk sign-in for the project reviewer, so members can send reviews (src/worker/hgab-reviews.ts). Only this page
 * loads Clerk. Email and a one-time code, no password: set in the Clerk dashboard, not here. Without
 * VITE_CLERK_PUBLISHABLE_KEY there is no sign-in, so no reviewing; projects can still be browsed.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { MemberContext, type Member } from '../lib/hgab-review-member';

const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, userId, getToken, signOut } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const value = useMemo<Member>(() => ({
    enabled: true,
    loaded: isLoaded,
    userId: userId ?? null,
    email,
    getToken: () => getToken(),
    // Back to this page (the project, its tab and the funnel) after signing in or up, by email or Google. Forced,
    // because the production instance's own "after sign-in" address is the home page.
    signIn: () => {
      const here = window.location.href;
      clerk.openSignIn({ withSignUp: true, forceRedirectUrl: here, signUpForceRedirectUrl: here });
    },
    // Back to the same project and funnel, reloaded so nothing of the member's stays on screen (shared computers).
    signOut: () => { const here = window.location.href; void signOut({ redirectUrl: here }).then(() => window.location.reload()); },
  }), [isLoaded, userId, email, getToken, signOut, clerk]);
  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export default function MemberProvider({ children }: { children: ReactNode }) {
  // Clerk navigates after signing in; through the router it stays a page update, so a review being written survives.
  const navigate = useNavigate();
  const go = useCallback((to: string, replace: boolean) => {
    const u = new URL(to, window.location.href);
    if (u.origin !== window.location.origin) window.location.assign(u.href);
    else navigate(`${u.pathname}${u.search}${u.hash}`, { replace });
  }, [navigate]);
  if (!KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={KEY} appearance={{ variables: { colorPrimary: '#0b4fd9', fontFamily: 'inherit' } }}
      routerPush={(to) => go(to, false)} routerReplace={(to) => go(to, true)}>
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}
