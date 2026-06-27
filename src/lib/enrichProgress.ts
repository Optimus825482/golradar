// ── Bulk Enrich Progress Tracker ──────────────────────────────
// In-memory progress store for Goaloo Phase 2 enrichment.
// Frontend poll'u ile gerçek zamanlı progress bar güncellemesi.

export interface EnrichProgress {
  running: boolean;
  total: number;
  processed: number;
  errors: number;
  startTime: number;
  currentMatch: string | null;     // "Home vs Away"
  currentLeague: string | null;
  recentMatches: string[];          // son 50 işlenen maç
}

let progress: EnrichProgress = {
  running: false,
  total: 0,
  processed: 0,
  errors: 0,
  startTime: 0,
  currentMatch: null,
  currentLeague: null,
  recentMatches: [],
};

/**
 * Yeni bir enrich işlemi başlat.
 */
export function startEnrich(total: number): void {
  progress = {
    running: true,
    total,
    processed: 0,
    errors: 0,
    startTime: Date.now(),
    currentMatch: null,
    currentLeague: null,
    recentMatches: [],
  };
}

/**
 * Her maç işlendiğinde çağır.
 */
export function tickEnrich(league: string, match: string, isError: boolean): void {
  if (!progress.running) return;
  progress.processed++;
  if (isError) progress.errors++;
  progress.currentLeague = league;
  progress.currentMatch = match;

  // Son 50 maçı tut
  progress.recentMatches.unshift(`${league}: ${match}`);
  if (progress.recentMatches.length > 50) {
    progress.recentMatches.pop();
  }
}

/**
 * Enrich işlemini tamamla.
 */
export function finishEnrich(): void {
  progress.running = false;
  progress.currentMatch = null;
}

/**
 * Şu anki progress durumunu döndür.
 */
export function getEnrichProgress(): EnrichProgress {
  return { ...progress, recentMatches: [...progress.recentMatches] };
}
