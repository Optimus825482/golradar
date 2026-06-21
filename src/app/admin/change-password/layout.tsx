import type { ReactNode } from "react";

// /admin/change-password bypasses the parent AdminLayout's sidebar so the
// focused password-change form renders without admin chrome.
export default function ChangePasswordLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}