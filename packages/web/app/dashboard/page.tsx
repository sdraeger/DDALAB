import { ProtectedRoute } from "shared/components/protected-route";
import { DashboardTabs } from "shared/components/dashboard-tabs";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col w-full">
        <div className="w-full">
          <DashboardTabs />
        </div>
      </main>
    </ProtectedRoute>
  );
}
