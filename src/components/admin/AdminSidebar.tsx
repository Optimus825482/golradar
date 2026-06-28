"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Brain,
  FlaskConical,
  Activity,
  BarChart3,
  Signal,
  TestTube,
  Zap,
  Target,
  Puzzle,
  DollarSign,
  Database,
  Download,
  RotateCcw,
  Menu,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// ── Navigation groups ──────────────────────────────────────────────
interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Gösterge Paneli",
    icon: LayoutDashboard,
    items: [
      { key: "overview", href: "/admin", label: "Genel Bakış", icon: LayoutDashboard, description: "Sistem durumu ve hızlı aksiyonlar" },
      { key: "ml-monitoring", href: "/admin/ml/monitoring", label: "Başarı Monitoring", icon: Activity, description: "Brier trend, drift, shadow takibi" },
    ],
  },
  {
    label: "Modeller",
    icon: Brain,
    items: [
      { key: "ml", href: "/admin/ml", label: "ML Modelleri", icon: Brain, description: "Artifactlar, champions, performans" },
      { key: "ml-train", href: "/admin/ml/train", label: "ML Eğitimi", icon: FlaskConical, description: "Manuel eğitim + pipeline" },
      { key: "ml-backtest", href: "/admin/ml/backtest", label: "ML Backtest", icon: BarChart3, description: "Model backtest + A/B karşılaştırma" },
    ],
  },
  {
    label: "Sinyaller",
    icon: Signal,
    items: [
      { key: "signals", href: "/admin/signals", label: "Sinyaller", icon: Signal, description: "Raw sinyal kayıtları, level, bucket" },
      { key: "signals-backtest", href: "/admin/signals/backtest", label: "Sinyal Backtest", icon: TestTube, description: "Algoritma backtest + replay" },
    ],
  },
  {
    label: "Analiz",
    icon: BarChart3,
    items: [
      { key: "calibration", href: "/admin/calibration", label: "Kalibrasyon", icon: Target, description: "Brier score, drift, bucket analizi" },
      { key: "ab-test", href: "/admin/ab-test", label: "A/B Test", icon: TestTube, description: "Eski vs Yeni sinyal sistemi" },
      { key: "algorithm", href: "/admin/algorithm", label: "Algoritma", icon: Puzzle, description: "Sinyal motoru akış diyagramı" },
      { key: "profit", href: "/admin/profit", label: "Kâr Simülasyonu", icon: DollarSign, description: "Sinyal kârlılığı, ROI, Sharpe" },
    ],
  },
  {
    label: "Yönetim",
    icon: Database,
    items: [
      { key: "ml-data-import", href: "/admin/ml/data-import", label: "Veri İçe Aktar", icon: Download, description: "Geçmiş maçları çek" },
      { key: "elo", href: "/admin/elo", label: "Elo Ratings", icon: Zap, description: "Takım gücü ratingleri" },
      { key: "reset", href: "/admin/reset", label: "Sıfırlama", icon: RotateCcw, description: "Sistem reset" },
    ],
  },
];

// ── Sidebar content (used in both desktop + mobile) ─────────────────
function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 overflow-y-auto p-2 md:p-3 space-y-3">
      {NAV_GROUPS.map((group) => {
        const groupActive = group.items.some(
          (item) => pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href))
        );
        return (
          <div key={group.label}>
            {/* Group header */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <group.icon className="size-3.5 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </span>
            </div>
            {/* Items */}
            <div className="ml-1 space-y-0.5">
              {group.items.map((item, idx) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname?.startsWith(item.href));
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    className={cn(
                      "group relative flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150 ease-out",
                      "hover:bg-gray-100 hover:scale-[1.02]",
                      "active:scale-[0.98]",
                      active
                        ? "bg-indigo-50 text-indigo-700 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-indigo-500"
                        : "text-gray-600"
                    )}
                  >
                    <item.icon className={cn("size-4 shrink-0", active ? "text-indigo-500" : "text-gray-400")} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Bottom link */}
      <div className="pt-2 mt-2 border-t border-gray-100">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-50 transition-all duration-150 ease-out"
        >
          ← Ana Sayfa
        </Link>
      </div>
    </nav>
  );
}

// ── Desktop sidebar ────────────────────────────────────────────────
function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden md:flex md:flex-col md:w-60 md:min-h-screen bg-white border-r border-gray-200 md:sticky md:top-0 md:self-start md:max-h-screen">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-sm shadow-sm">
            GR
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800 leading-tight">Gol Radarı</div>
            <div className="text-[10px] text-gray-400">Admin Panel</div>
          </div>
        </div>
      </div>

      <SidebarContent pathname={pathname} />
    </aside>
  );
}

// ── Mobile sidebar (Sheet overlay) ─────────────────────────────────
function MobileSidebar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white sticky top-0 z-40">
      <div className="flex items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-60">
            <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
              <div className="size-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-xs shadow-sm">
                GR
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">Gol Radarı</div>
                <div className="text-[10px] text-gray-400">Admin Panel</div>
              </div>
            </div>
            <SidebarContent pathname={pathname} />
          </SheetContent>
        </Sheet>
        <span className="text-sm font-semibold text-gray-700">Gol Radarı</span>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <>
      <MobileSidebar pathname={pathname} />
      <DesktopSidebar pathname={pathname} />
    </>
  );
}
