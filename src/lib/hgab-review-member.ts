/**
 * Who is signed in to the project reviewer, for components that send reviews. The Clerk side lives in
 * src/components/HgabReviewMember.tsx; without a publishable key (VITE_CLERK_PUBLISHABLE_KEY) sign-in is off and the
 * page has no reviewing; projects can still be browsed.
 */
import { createContext, useContext } from 'react';
import { documentHref } from './hgab-review-api';

export interface Member {
  /** Whether sign-in is set up in this build. */
  enabled: boolean;
  /** Whether Clerk has said who, if anyone, is signed in. */
  loaded: boolean;
  userId: string | null;
  email: string | null;
  getToken: () => Promise<string | null>;
  /** Opens the sign-in (or sign-up) dialog: email, then a code; no password. */
  signIn: () => void;
  signOut: () => void;
}

export const SIGNED_OUT: Member = {
  enabled: false, loaded: true, userId: null, email: null, getToken: async () => null, signIn: () => {}, signOut: () => {},
};
export const MemberContext = createContext<Member>(SIGNED_OUT);
export const useMember = () => useContext(MemberContext);

/**
 * Where to open a document, by its address in the data: Senate copies only with the signed-in member's grant (null
 * otherwise), DPWH Transparency files as they are. The reviewer page provides it.
 */
export const DocLinkContext = createContext<(url: string) => string | null>((url) => documentHref(url, null));
export const useDocLink = () => useContext(DocLinkContext);
