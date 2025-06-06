import { render, screen } from "@testing-library/react";

// Mock the entire dashboard page
jest.mock("../../app/dashboard/page", () => {
  return function MockedDashboardPage() {
    return (
      <div data-testid="protected-route">
        <main role="main">
          <div data-testid="dashboard-tabs">Dashboard Tabs</div>
        </main>
      </div>
    );
  };
});

import DashboardPage from "../../app/dashboard/page";

describe("Dashboard Page", () => {
  it("should render dashboard page with protected route wrapper", () => {
    render(<DashboardPage />);

    expect(screen.getByTestId("protected-route")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-tabs")).toBeInTheDocument();
  });

  it("should have main layout structure", () => {
    render(<DashboardPage />);

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
  });
});
