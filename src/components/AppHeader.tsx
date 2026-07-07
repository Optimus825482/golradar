"use client";

import { Badge } from "@/components/ui/badge";

interface AppHeaderProps {
  lastUpdate: Date | null;
  wsConnected: boolean;
  sortBy: "league" | "time";
  onToggleSort: () => void;
  liveCount: number;
}

export function AppHeader({
  lastUpdate,
  wsConnected,
  sortBy,
  onToggleSort,
  liveCount,
}: AppHeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm safe-top">
      <div className="max-w-350 mx-auto px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src="/logo-192.png"
            alt="Gol Radarı"
            className="w-8 h-8 rounded-lg shadow-sm object-cover"
          />
          <div>
            <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">
              Gol Radarı
            </h1>
            <p className="text-[10px] text-gray-400 leading-tight flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              {lastUpdate
                ? `Canlı · ${lastUpdate.toLocaleTimeString("tr-TR")}`
                : "—"}
              {wsConnected && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block ml-1"
                  title="WebSocket bagli"
                />
              )}
              {!wsConnected && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block ml-1"
                  title="WebSocket bagli degil, HTTP poll aktif"
                />
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleSort}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors"
            aria-label={
              sortBy === "league"
                ? "Dakikaya göre sırala (yüksekten düşüğe)"
                : "Lige göre sırala"
            }
            title={
              sortBy === "league"
                ? "Lig sıralaması"
                : "Dakika sıralaması (en ileri maç üstte)"
            }
          >
            {sortBy === "league" ? (
              <svg
                className="w-4 h-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                />
              </svg>
            )}
          </button>
          {liveCount > 0 && (
            <Badge className="bg-emerald-50 text-emerald-700 text-[10px] hover:bg-emerald-50 border border-emerald-200 px-2 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
              {liveCount}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
