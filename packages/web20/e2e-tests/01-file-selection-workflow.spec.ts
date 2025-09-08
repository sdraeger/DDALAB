import { expect } from '@playwright/test';
import { test } from './fixtures/dashboard-fixture';

test.describe('File Selection Workflow', () => {

  test('should display dashboard with basic elements', async ({ dashboardPage }) => {
    // Verify main dashboard elements are present
    await expect(dashboardPage.saveLayoutButton).toBeVisible();
    await expect(dashboardPage.reloadLayoutButton).toBeVisible();
    await expect(dashboardPage.clearLayoutButton).toBeVisible();
    await expect(dashboardPage.noFileLoadedText).toBeVisible();
    
    // Verify the debug info showing widgets and initialization status
    await expect(dashboardPage.page.locator('text=Widgets: 0')).toBeVisible();
    await expect(dashboardPage.page.locator('text=Initialized: Yes')).toBeVisible();
  });

  test('should be able to interact with layout controls', async ({ dashboardPage, readyPage }) => {
    // Test the layout control buttons work
    await dashboardPage.saveLayoutButton.click();
    await readyPage.waitForTimeout(500);
    
    await dashboardPage.reloadLayoutButton.click();
    await readyPage.waitForTimeout(500);
    
    // Verify the dashboard is still functional after button clicks
    await expect(dashboardPage.saveLayoutButton).toBeVisible();
    await expect(dashboardPage.noFileLoadedText).toBeVisible();
    
    // Test clear layout (should not break anything since no widgets exist)
    await dashboardPage.clearLayoutButton.click();
    await readyPage.waitForTimeout(500);
    
    // Should still show 0 widgets
    await expect(dashboardPage.page.locator('text=Widgets: 0')).toBeVisible();
  });

  test('should maintain responsive layout', async ({ dashboardPage, readyPage }) => {
    // Test responsive behavior with the basic dashboard
    await readyPage.setViewportSize({ width: 1280, height: 720 });
    await readyPage.waitForTimeout(500);
    
    // Verify layout controls are still visible
    await expect(dashboardPage.saveLayoutButton).toBeVisible();
    await expect(dashboardPage.noFileLoadedText).toBeVisible();
    
    // Test mobile viewport
    await readyPage.setViewportSize({ width: 375, height: 667 });
    await readyPage.waitForTimeout(1000);
    
    // Basic dashboard elements should still be accessible
    await expect(dashboardPage.page.locator('text=Widgets: 0')).toBeVisible();
    
    // Reset to desktop
    await readyPage.setViewportSize({ width: 1280, height: 720 });
  });

  test.skip('file browser functionality', async () => {
    // Skipped until file browser widget is implemented
    // Will test navigation and file selection when widgets are added
  });

  test.skip('DDA analysis workflow', async () => {
    // Skipped until DDA widget is implemented
    // Will test file processing and variant selection
  });

  test.skip('widget interactions and state management', async () => {
    // Skipped until widgets are implemented
    // Will test state propagation between widgets
  });
});