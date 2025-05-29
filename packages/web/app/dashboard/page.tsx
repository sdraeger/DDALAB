import { DashboardLayout } from "./DashboardLayout";
import { DashboardTabs } from "shared/components/layout/DashboardTabs";

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <DashboardTabs />
    </DashboardLayout>
  );
}
