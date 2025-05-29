import { ReactNode } from "react";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";

interface DashboardLayoutProps {
  children: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <ProtectedRoute>
      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </ProtectedRoute>
  );
};
