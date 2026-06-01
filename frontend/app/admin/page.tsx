import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin-dashboard";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = {
  title: "Admin · Vyasa AI Assistant",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-muted/20">
      <TopBar rightLabel="Admin" />
      <main className="flex-1 min-h-0">
        <AdminDashboard />
      </main>
    </div>
  );
}
