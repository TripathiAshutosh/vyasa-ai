import { ChatInterface } from "@/components/chat-interface";
import { DocumentSidebar } from "@/components/document-sidebar";

export default function HomePage() {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <DocumentSidebar />
      <main className="flex-1 min-w-0">
        <ChatInterface />
      </main>
    </div>
  );
}
