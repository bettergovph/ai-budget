/**
 * Stands in for src/components/HgabReviewMember.tsx while `npm run build:hgab-review-howto` takes the guide's
 * screenshots: a signed-in demo member, no Clerk. Only the screenshot run's dev server uses it (a Vite alias); the app
 * never imports it. `window.__HOWTO_MEMBER = 'out'` shows the signed-out page instead.
 */
import type { ReactNode } from 'react';
import { MemberContext, type Member } from '../../src/lib/hgab-review-member';

const base: Member = {
  enabled: true, loaded: true, userId: null, email: null, name: null,
  getToken: async () => null, signIn: () => {}, signOut: () => {},
};
const DEMO: Member = { ...base, userId: 'demo-member', email: 'juan.delacruz@example.com', name: 'Juan dela Cruz', getToken: async () => 'demo-token' };

export default function DemoMemberProvider({ children }: { children: ReactNode }) {
  const out = (window as unknown as { __HOWTO_MEMBER?: string }).__HOWTO_MEMBER === 'out';
  return <MemberContext.Provider value={out ? base : DEMO}>{children}</MemberContext.Provider>;
}
