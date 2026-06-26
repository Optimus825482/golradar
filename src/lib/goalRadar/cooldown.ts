// ── Goal Cooldown ─────────────────────────────────────────────────
// Detects recent goals from pressure history and applies quadratic
// suppression to prevent double-counting post-goal threat waves.
// Based on PLOS One 2024 event-sequence window (20 snapshots ≈ 5 min).

	import type { PressureSnapshotLite } from './types';
	
	export interface CooldownResult {
	  goalCooldownHome: number;
	  goalCooldownAway: number;
	  recentGoalSide: "home" | "away" | "both" | null;
	}
	
	/**
	 * Detect if a goal was recently scored by comparing goal counts
	 * across pressure history snapshots. Returns cooldown factors
	 * (0.0 = full cooldown, 1.0 = no cooldown) per side.
	 *
	 * 12-snapshot window (~3 min) with linear decay:
	 *   cooldownFactor = progress  where progress = snapshotsAgo / 12
	 */
	export function detectGoalCooldown(
	  pressureHistory: PressureSnapshotLite[] | undefined,
	  currentHomeGoals: number | undefined,
	  currentAwayGoals: number | undefined,
	): CooldownResult {
	  let goalCooldownHome = 0;
	  let goalCooldownAway = 0;
	  let recentGoalSide: "home" | "away" | "both" | null = null;
	  const GOAL_COOLDOWN_SNAPSHOTS = 12;
	
	  if (pressureHistory && pressureHistory.length >= 2) {
	    const currentHG =
	      currentHomeGoals ?? pressureHistory[pressureHistory.length - 1].homeGoals;
	    const currentAG =
	      currentAwayGoals ?? pressureHistory[pressureHistory.length - 1].awayGoals;
	    if (currentHG != null && currentAG != null) {
	      for (let i = pressureHistory.length - 1; i >= 1; i--) {
	        const snap = pressureHistory[i];
	        const prev = pressureHistory[i - 1];
	        const snapHG = snap.homeGoals,
	          snapAG = snap.awayGoals;
	        const prevHG = prev.homeGoals,
	          prevAG = prev.awayGoals;
	        if (
	          snapHG == null ||
	          snapAG == null ||
	          prevHG == null ||
	          prevAG == null
	        )
	          continue;
	        const homeGoalScored = snapHG > prevHG;
	        const awayGoalScored = snapAG > prevAG;
	        if (homeGoalScored || awayGoalScored) {
	          const snapshotsAgo = pressureHistory.length - 1 - i;
	          if (homeGoalScored && awayGoalScored) recentGoalSide = "both";
	          else if (homeGoalScored) recentGoalSide = "home";
	          else recentGoalSide = "away";
	          const progress = Math.min(1, snapshotsAgo / GOAL_COOLDOWN_SNAPSHOTS);
	          const cooldownFactor = progress; // linear decay
	          if (homeGoalScored) goalCooldownHome = cooldownFactor;
	          if (awayGoalScored) goalCooldownAway = cooldownFactor;
	          break;
	        }
	      }
	    }
	  }
	
	  return { goalCooldownHome, goalCooldownAway, recentGoalSide };
	}
	
	export interface CooldownApplyResult {
	  homeScore: number;
	  awayScore: number;
	  factors: string[];
	}
	
	/**
	 * Apply cooldown to scores. The team that scored gets × cooldownFactor × 0.6
	 * suppression (mild). The opposing team gets × max(cooldownFactor, otherSide × 0.8).
	 */
	export function applyGoalCooldown(
	  homeScore: number,
	  awayScore: number,
	  goalCooldownHome: number,
	  goalCooldownAway: number,
	  recentGoalSide: "home" | "away" | "both" | null,
	): CooldownApplyResult {
	  const factors: string[] = [];
	  let hs = homeScore, as = awayScore;
	
	  if (goalCooldownHome < 1 || goalCooldownAway < 1) {
	    if (recentGoalSide === "home") {
	      hs = Math.round(hs * Math.max(goalCooldownHome, 0.6));
	      as = Math.round(as * Math.max(goalCooldownAway, goalCooldownHome * 0.8));
	    } else if (recentGoalSide === "away") {
	      as = Math.round(as * Math.max(goalCooldownAway, 0.6));
	      hs = Math.round(hs * Math.max(goalCooldownHome, goalCooldownAway * 0.8));
	    } else if (recentGoalSide === "both") {
	      hs = Math.round(hs * Math.max(goalCooldownHome, 0.6));
	      as = Math.round(as * Math.max(goalCooldownAway, 0.6));
	    }
	    if (recentGoalSide && (hs >= 20 || as >= 20)) {
	      const goalSideLabel =
	        recentGoalSide === "home"
	          ? "Ev sahibi"
	          : recentGoalSide === "away"
	            ? "Deplasman"
	            : "Her iki";
	      factors.push(`Gol sonrası soğuma (${goalSideLabel})`);
	    }
	  }
	
	  return { homeScore: hs, awayScore: as, factors };
	}
