import { ProtectedRoute } from "shared/components/protected-route";
import { DashboardTabs } from "shared/components/dashboard-tabs";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center p-4 md:p-8">
        <div className="w-full max-w-7xl">
          <DashboardTabs />
        </div>
      </main>
    </ProtectedRoute>
  );
}
