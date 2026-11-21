/**
 * Which leaderboard the board pieces (src/components/HgabLeaderboardBits.tsx) draw: its boards, for the pager and the
 * list of boards, and its address. The House bill's by default; the Senate leaderboards (SenateLeaderboard.tsx)
 * provide their own.
 */
import { createContext } from 'react';
import { BOARDS, leaderboardPath, type BoardDef, type ShareFormat } from './hgab-leaderboard';

export interface LeaderboardSite {
  boards: readonly BoardDef[];
  path: (boardId?: string, opts?: { region?: string | null; format?: ShareFormat | null }) => string;
}

export const LeaderboardSiteContext = createContext<LeaderboardSite>({ boards: BOARDS, path: leaderboardPath });
