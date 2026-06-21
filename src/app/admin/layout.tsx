import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

// Routes inside /admin that bypass the sidebar (focused auth flows).
// The login + change-password routes have their own minimal child layouts,
// but Next.js wraps the parent layout around them. We check cookies here
// so the sidebar only renders for authenticated sessions.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  const isAuthed = Boolean(token);

  if (!isAuthed) {
    // Skip sidebar for unauthenticated users — they should only see
    // login / change-password forms.
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      <AdminSidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-3 py-4 md:px-6 md:py-6">
          {children}
        </div>
      </main>
    </div>
  );
}