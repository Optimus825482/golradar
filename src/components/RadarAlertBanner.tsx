"use client";

interface RadarAlertBannerProps {
  radarCount: number;
  onClick: () => void;
}

export function RadarAlertBanner({
  radarCount,
  onClick,
}: RadarAlertBannerProps) {
  if (radarCount === 0) return null;

  return (
    <div className="bg-linear-to-r from-red-500 via-red-600 to-red-500 border-b border-red-700">
      <div className="max-w-350 mx-auto px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg
              className="w-4 h-4 text-white animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping" />
          </div>
          <span className="text-white text-xs font-bold">GOL RADARI</span>
          <span className="text-red-100 text-[10px]">
            {radarCount} maç
          </span>
        </div>
        <button
          onClick={onClick}
          className="px-2.5 py-0.5 bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold rounded-full transition-all backdrop-blur-sm"
        >
          Görüntüle →
        </button>
      </div>
    </div>
  );
}
