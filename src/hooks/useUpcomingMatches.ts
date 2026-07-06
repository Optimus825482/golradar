'use client';

import { useEffect, useState } from 'react';

export interface UpcomingMatch {
  code: number;
  home: string;
  away: string;
  league: string;
  date: string;
  time: string;
  day: string;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
}

interface UpcomingMatchesResponse {
  matches?: UpcomingMatch[];
}

export function useUpcomingMatches(days = 3): UpcomingMatch[] {
  const [upcomingList, setUpcomingList] = useState<UpcomingMatch[]>([]);

  useEffect(() => {
    fetch(`/api/upcoming-matches?days=${days}`)
      .then((r) => r.json() as Promise<UpcomingMatchesResponse>)
      .then((d) => { if (d.matches) setUpcomingList(d.matches); })
      .catch(() => {});
  }, [days]);

  return upcomingList;
}
