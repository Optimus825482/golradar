import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  const isAuthed = Boolean(token);

  if (!isAuthed) {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      <AdminSidebar />
      <main className="flex-1 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-3 py-3 md:px-6 md:py-6 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
          {children}
        </div>
      </main>
    </div>
  );
}
