import type { Metadata } from "next";
import { AdminTabs } from "@/components/admin-tabs";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = {
  title: "Admin · Vyasa AI Assistant",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-muted/20">
      <div className="print:hidden">
        <TopBar rightLabel="Admin" />
      </div>
      <main className="flex-1 min-h-0">
        <AdminTabs />
      </main>
    </div>
  );
}
