'use client'

import type { BottomTab } from './types'

interface NavTab {
  key: BottomTab | 'signal-history'
  label: string
  badge?: number
  icon: (active: boolean) => React.ReactNode
}

interface BottomNavBarProps {
  activeTab: string
  liveCount: number
  radarCount: number
  favCount: number
  finishedCount?: number
  onTabChange: (tab: any) => void
}

export function BottomNavBar({
  activeTab, liveCount, radarCount, favCount, finishedCount,
  onTabChange,
}: BottomNavBarProps) {
  const tabs: NavTab[] = [
    {
      key: 'all', label: 'Ana Sayfa',
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? 'text-emerald-600' : 'text-gray-400'}`} fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 2}>
          {active ? (
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          )}
        </svg>
      ),
    },
    {
      key: 'live', label: 'Canlı', badge: liveCount,
      icon: (active: boolean) => (
        <div className="relative">
          <svg className={`w-5 h-5 ${active ? 'text-emerald-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {liveCount > 0 && !active && (
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
          )}
        </div>
      ),
    },
    {
      key: 'radar', label: 'Gol Radarı', badge: radarCount,
      icon: (active: boolean) => (
        <div className="relative">
          <svg className={`w-5 h-5 ${active ? 'text-red-600' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          {radarCount > 0 && !active && (
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          )}
        </div>
      ),
    },
    {
      key: 'favorites', label: 'Favoriler', badge: favCount,
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? 'text-amber-500' : 'text-gray-400'}`} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
    {
      key: 'finished', label: 'Biten', badge: finishedCount,
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      key: 'signal-history', label: 'Sinyaller',
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 safe-bottom shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
      <div className="max-w-3xl mx-auto flex items-center justify-around h-[56px] md:h-[52px]">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors relative ${
              activeTab === tab.key
                ? tab.key === 'radar'
                  ? 'text-red-600'
                  : tab.key === 'favorites'
                  ? 'text-amber-500'
                  : tab.key === 'finished'
                  ? 'text-blue-600'
                  : tab.key === 'signal-history'
                  ? 'text-indigo-600'
                  : 'text-emerald-600'
                : 'text-gray-400'
            }`}
          >
            {tab.icon(activeTab === tab.key)}
            <span className={`text-[10px] font-medium ${activeTab === tab.key ? 'font-bold' : ''}`}>
              {tab.label}
            </span>
            {tab.badge && tab.badge > 0 && (
              <span className={`absolute -top-0.5 right-1/2 translate-x-4 text-[8px] font-bold px-1 rounded-full ${
                tab.key === 'radar' ? 'bg-red-100 text-red-600' :
                tab.key === 'live' ? 'bg-emerald-100 text-emerald-600' :
                tab.key === 'finished' ? 'bg-blue-100 text-blue-600' :
                'bg-amber-100 text-amber-600'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
