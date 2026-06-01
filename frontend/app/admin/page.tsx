import type { Metadata } from "next";
import { ChatInterface } from "@/components/chat-interface";
import { DocumentSidebar } from "@/components/document-sidebar";

export const metadata: Metadata = {
  title: "Admin · Vyasa AI Assistant",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <DocumentSidebar />
      <main className="flex-1 min-w-0">
        <ChatInterface />
      </main>
    </div>
  );
}
