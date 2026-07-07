"use client";

import type { Match } from "./types";
import { MatchDetailContent } from "@/components/match/MatchDetailContent";
import type { MatchDetailContentProps } from "@/components/match/MatchDetailContent";

interface DesktopDetailPanelProps {
  selectedMatch: Match;
  detailProps: MatchDetailContentProps | null;
  onClose: () => void;
}

export function DesktopDetailPanel({
  selectedMatch,
  detailProps,
  onClose,
}: DesktopDetailPanelProps) {
  return (
    <div className="hidden md:flex w-full overflow-y-auto bg-white flex-col">
      {/* Sticky header with back button */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between shadow-sm">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors group"
        >
          <svg
            className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span className="text-sm font-medium">Geri</span>
        </button>
        <span className="text-sm font-semibold text-gray-600">
          {selectedMatch.home} vs {selectedMatch.away}
        </span>
        {/* Spacer for flex alignment */}
        <div className="w-16" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {detailProps && (
          <MatchDetailContent {...(detailProps as MatchDetailContentProps)} />
        )}
      </div>
    </div>
  );
}
