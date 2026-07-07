"use client";

import { createPortal } from "react-dom";
import type { GoalNotification } from "@/components/match/types";

interface GoalNotificationToastsProps {
  goalNotifications: GoalNotification[];
  favoritesLoaded: boolean;
}

export function GoalNotificationToasts({
  goalNotifications,
  favoritesLoaded,
}: GoalNotificationToastsProps) {
  if (goalNotifications.length === 0 || !favoritesLoaded) return null;

  return createPortal(
    <div
      className="fixed top-16 right-3 z-100 flex flex-col gap-2 pointer-events-none"
      style={{ maxWidth: "340px" }}
    >
      {goalNotifications.map((notif) => (
        <div
          key={notif.id}
          className="pointer-events-auto animate-[slideInRight_0.4s_ease-out] bg-linear-to-r from-green-500 via-emerald-500 to-green-600 rounded-xl shadow-2xl border border-green-400 p-3 text-white"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="relative">
              <div className="text-lg">⚽</div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" />
            </div>
            <span className="font-black text-sm tracking-wide animate-pulse">
              GOL!
            </span>
            <span className="text-[10px] text-green-200 ml-auto">
              {notif.minute}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-bold ${notif.scoringTeam === "home" ? "text-yellow-200" : ""}`}
            >
              {notif.home}
            </span>
            <span className="text-xl font-black mx-2">
              {notif.homeGoals} - {notif.awayGoals}
            </span>
            <span
              className={`text-xs font-bold ${notif.scoringTeam === "away" ? "text-yellow-200" : ""}`}
            >
              {notif.away}
            </span>
          </div>
          <div className="text-[10px] text-green-200 mt-0.5">
            {notif.league}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
