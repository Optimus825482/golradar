"use client"

import SignalsCenter from "./SignalsCenter"
import type { Match } from "@/components/match/types"

interface LegacyPanelProps {
  matches?: Match[]
  onSelectMatch?: (match: Match) => void
}

export default function SignalHistoryPanel({
  matches = [],
  onSelectMatch,
}: LegacyPanelProps) {
  const handleSelect = (m: Match) => {
    if (onSelectMatch) onSelectMatch(m)
  }
  return <SignalsCenter matches={matches} onSelectMatch={handleSelect} />
}
