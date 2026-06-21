import type { ReactNode } from "react";

// /admin/login needs its own minimal layout — bypasses the parent
// AdminLayout (which always renders AdminSidebar). Without this, the
// sidebar would show alongside the login form.
export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}