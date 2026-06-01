import { ChatInterface } from "@/components/chat-interface";
import { TopBar } from "@/components/top-bar";

export default function HomePage() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 min-h-0">
        <ChatInterface />
      </main>
    </div>
  );
}
