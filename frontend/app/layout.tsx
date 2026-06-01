import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Vyasa AI Assistant · CSJM University, Kanpur — PhD Admission 2026–27",
  description:
    "Official PhD admission assistant for Chhatrapati Shahu Ji Maharaj University, Kanpur. Clear answers for the 2026–27 session, drawn straight from the admission documents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans">
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
