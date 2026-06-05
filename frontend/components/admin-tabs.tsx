"use client";

import { BarChart3, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export function AdminTabs() {
  return (
    <Tabs defaultValue="documents" className="flex h-full flex-col">
      <div className="flex justify-center border-b bg-background px-6 py-2">
        <TabsList>
          <TabsTrigger value="documents">
            <FileText className="h-3.5 w-3.5" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="documents" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <AdminDashboard />
      </TabsContent>
      <TabsContent value="analytics" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <AnalyticsDashboard />
      </TabsContent>
    </Tabs>
  );
}
