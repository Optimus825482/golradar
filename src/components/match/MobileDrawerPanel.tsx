"use client";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { MatchDetailContent } from "@/components/match/MatchDetailContent";
import { MatchStatusBadge } from "@/components/match/shared-components";
import type { MatchDetailContentProps } from "@/components/match/MatchDetailContent";
import type { Match } from "./types";

interface MobileDrawerPanelProps {
  drawerOpen: boolean;
  selectedMatch: Match | null;
  detailProps: MatchDetailContentProps | null;
  onClose: () => void;
  isMobile: boolean;
}

export function MobileDrawerPanel({
  drawerOpen,
  selectedMatch,
  detailProps,
  onClose,
  isMobile,
}: MobileDrawerPanelProps) {
  if (!isMobile) return null;
  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      shouldScaleBackground
    >
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="p-3 pb-0">
          <DrawerTitle className="text-sm font-semibold text-gray-700">
            {selectedMatch
              ? `${selectedMatch.home} vs ${selectedMatch.away}`
              : "Maç Detayı"}
          </DrawerTitle>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <DrawerDescription className="text-[10px] text-gray-400">
              {selectedMatch?.league}
            </DrawerDescription>
            <span className="text-gray-300">·</span>
            <MatchStatusBadge match={selectedMatch!} />
          </div>
        </DrawerHeader>
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(92dvh - 80px)" }}
        >
          {selectedMatch && detailProps && (
            <MatchDetailContent
              {...(detailProps as MatchDetailContentProps)}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
