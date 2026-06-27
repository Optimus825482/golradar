"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    key: "overview",
    href: "/admin",
    label: "Overview",
    icon: "📊",
    description: "Sistem durumu ve hızlı aksiyonlar",
  },
  {
    key: "ml",
    href: "/admin/ml",
    label: "ML Modelleri",
    icon: "🤖",
    description: "Artifactlar, champions, performans",
  },
  {
    key: "ml-train",
    href: "/admin/ml/train",
    label: "ML Eğitimi",
    icon: "🚀",
    description: "Manuel eğitim + pipeline",
  },
  {
    key: "ml-data-import",
    href: "/admin/ml/data-import",
    label: "Veri İçe Aktar",
    icon: "📥",
    description: "Geçmiş maçları Fotmob/Sofascore'dan çek",
  },
  {
    key: "ml-backtest",
    href: "/admin/ml/backtest",
    label: "ML Backtest",
    icon: "🔬",
    description: "Model backtest + A/B karşılaştırma",
  },
  {
    key: "ml-monitoring",
    href: "/admin/ml/monitoring",
    label: "Başarı Monitoring",
    icon: "📈",
    description: "Brier trend, drift, shadow takibi",
  },
  {
    key: "signals",
    href: "/admin/signals",
    label: "Sinyaller",
    icon: "📡",
    description: "Raw sinyal kayıtları, level, bucket",
  },
  {
    key: "signals-backtest",
    href: "/admin/signals/backtest",
    label: "Sinyal Backtest",
    icon: "🧪",
    description: "Algoritma backtest + replay",
  },
  {
    key: "elo",
    href: "/admin/elo",
    label: "Elo Ratings",
    icon: "⚡",
    description: "Takım gücü ratingleri",
  },
  {
    key: "calibration",
    href: "/admin/calibration",
    label: "Kalibrasyon",
    icon: "🎯",
    description: "Brier score, drift, bucket analizi",
  },
  {
    key: "algorithm",
    href: "/admin/algorithm",
    label: "Algoritma",
    icon: "🧠",
    description: "Sinyal motoru akış diyagramı",
  },
  {
    key: "ab-test",
    href: "/admin/ab-test",
    label: "A/B Test",
    icon: "🔬",
    description: "Eski vs Yeni sinyal sistemi karşılaştırması",
  },
  {
    key: "profit",
    href: "/admin/profit",
    label: "Kâr Simülasyonu",
    icon: "💰",
    description: "Sinyal kârlılığı, ROI, Sharpe",
  },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full md:w-64 md:min-h-screen bg-white border-b md:border-b-0 md:border-r border-gray-200 md:sticky md:top-0 md:self-start md:max-h-screen md:overflow-y-auto">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-sm">
            GR
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800">Gol Radarı</div>
            <div className="text-[10px] text-gray-500">Admin Panel</div>
          </div>
        </div>
      </div>

      <nav className="p-2 md:p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`block rounded-lg px-3 py-2.5 transition-all ${
                active
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "text-gray-700 hover:bg-gray-50 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{item.icon}</span>
                <span className="text-[13px] font-semibold">{item.label}</span>
              </div>
              <div className={`text-[10px] mt-0.5 ${active ? "text-indigo-600/70" : "text-gray-400"}`}>
                {item.description}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="hidden md:block p-3 border-t border-gray-100 mt-2">
        <Link
          href="/"
          className="block text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded hover:bg-gray-50"
        >
          ← Ana Sayfa
        </Link>
      </div>
    </aside>
  );
}
