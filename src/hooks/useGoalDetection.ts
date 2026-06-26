"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playGoalSound } from "@/lib/playGoalSound";
import type { GoalNotification } from "@/components/match/types";

const GOAL_FLASH_DURATION = 15_000;
const SOUND_RECOVERY_DELAY = 1_500;

interface FlashEntry {
  startedAt: number;
  expiresAt: number;
}

	export interface UseGoalDetectionResult {
	  goalFlashMap: Record<number, FlashEntry>;
	  goalNotifications: GoalNotification[];
	  prevGoalsRef: React.MutableRefObject<Record<number, { home: number; away: number; status: number }>>;
	  addGoalNotification: (notification: GoalNotification) => void;
	  clearGoalNotification: (id: string) => void;
	  dismissFlash: (matchCode: number) => void;
	}

/**
 * Goal-related side-effects: ephemeral flash highlight on the match
 * card (15s window), persistent notification list, prev-goals tracking
 * for match-end detection, and the goal-sound effect (with autoplay
 * recovery for browsers that block the first attempt).
 */
export function useGoalDetection(): UseGoalDetectionResult {
  const [goalFlashMap, setGoalFlashMap] = useState<
    Record<number, FlashEntry>
  >({});
  const [goalNotifications, setGoalNotifications] = useState<
    GoalNotification[]
  >([]);
  const prevGoalsMap = useRef<
    Record<number, { home: number; away: number; status: number }>
  >({});
  const flashTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const playSoundEnabled = useRef(true);

  // Cleanup pending flash timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of flashTimersRef.current.values()) {
        clearTimeout(timer);
      }
      flashTimersRef.current.clear();
    };
  }, []);

  const triggerFlash = useCallback((matchCode: number): void => {
    const now = Date.now();
    const entry: FlashEntry = {
      startedAt: now,
      expiresAt: now + GOAL_FLASH_DURATION,
    };

    const existing = flashTimersRef.current.get(matchCode);
    if (existing) clearTimeout(existing);

    setGoalFlashMap((prev) => ({ ...prev, [matchCode]: entry }));

    const timer = setTimeout(() => {
      setGoalFlashMap((prev) => {
        const next = { ...prev };
        delete next[matchCode];
        return next;
      });
      flashTimersRef.current.delete(matchCode);
    }, GOAL_FLASH_DURATION);
    flashTimersRef.current.set(matchCode, timer);
  }, []);

  const dismissFlash = useCallback((matchCode: number): void => {
    const timer = flashTimersRef.current.get(matchCode);
    if (timer) clearTimeout(timer);
    flashTimersRef.current.delete(matchCode);
    setGoalFlashMap((prev) => {
      const next = { ...prev };
      delete next[matchCode];
      return next;
    });
  }, []);

  const addGoalNotification = useCallback(
    (notification: GoalNotification): void => {
      setGoalNotifications((prev) => [...prev, notification]);
      triggerFlash(notification.matchCode);

      if (playSoundEnabled.current) {
        try {
          playGoalSound();
        } catch {
          playSoundEnabled.current = false;
          setTimeout(() => {
            playSoundEnabled.current = true;
          }, SOUND_RECOVERY_DELAY);
        }
      }
    },
    [triggerFlash],
  );

  const clearGoalNotification = useCallback((id: string): void => {
    setGoalNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

	  return {
	    goalFlashMap,
	    goalNotifications,
	    prevGoalsRef: prevGoalsMap,
	    addGoalNotification,
	    clearGoalNotification,
	    dismissFlash,
	  };
}
