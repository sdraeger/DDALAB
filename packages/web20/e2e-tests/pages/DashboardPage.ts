import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  // Main layout elements (use generic selectors that match the actual HTML)
  readonly sidebar = this.page.locator('div:has(> div:has-text("Dashboard")) >> nth=0, aside, [role="navigation"]');
  readonly mainContent = this.page.locator('main, div.flex-1:has(div.p-6)');
  readonly footer = this.page.locator('footer, div:has-text("Footer")');
  
  // Dashboard specific elements (more specific selectors)
  readonly layoutControls = this.page.locator('.flex.items-center.justify-between').first();
  readonly saveLayoutButton = this.page.locator('button:has-text("Save Layout")').first();
  readonly reloadLayoutButton = this.page.locator('button:has-text("Reload")').first();
  readonly clearLayoutButton = this.page.locator('button:has-text("Clear")').first();
  
  // Currently loaded file indicator
  readonly currentFileIndicator = this.page.locator('.flex.items-center.gap-2').last();
  readonly noFileLoadedText = this.page.locator('span:has-text("No file loaded")').first();
  
  // Widget related - using more generic selectors
  readonly widgetContainer = this.page.locator('[data-rgl], .react-grid-layout');
  readonly widgets = this.page.locator('[data-grid], .react-grid-item');
  readonly addWidgetButton = this.page.locator('button:has-text("Add Widget"), button:has-text("+")');
  
  // File browser widget (look for common file browser patterns)
  readonly fileBrowser = this.page.locator('div:has-text("File Browser"), [data-testid*="file-browser"]');
  readonly fileBrowserFiles = this.page.locator('div:has-text(".edf"), div:has-text(".txt"), [data-file-type]');
  readonly fileBrowserUpButton = this.page.locator('button:has-text("Up"), button:has-text("↑"), button:has-text("Parent")');
  
  // DDA widget
  readonly ddaWidget = this.page.locator('div:has-text("DDA Analysis"), [data-testid*="dda"]');
  readonly ddaFilePathInput = this.page.locator('input[placeholder*="file"], input[name*="file"], input[name*="path"]');
  readonly ddaChannelInput = this.page.locator('input[placeholder*="channel"], input[name*="channel"]');
  readonly ddaRunButton = this.page.locator('button:has-text("Run"), button:has-text("Start"), button:has-text("Analyze")');
  readonly ddaVariantSelector = this.page.locator('div:has(input[type="checkbox"]):has-text("Variant")');
  readonly ddaVariantOptions = this.page.locator('input[type="checkbox"]');
  
  // Plot widgets
  readonly plotWidgets = this.page.locator('canvas, svg, [data-testid*="plot"]');
  readonly ddaLinePlot = this.page.locator('div:has-text("Line Plot"), canvas:nth-of-type(1)');
  readonly ddaHeatmap = this.page.locator('div:has-text("Heatmap"), canvas:nth-of-type(2)');
  
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/');
    await this.waitForDashboard();
  }

  async waitForDashboard() {
    // Handle auth detection hydration issue - known Next.js dev mode issue
    const authDetecting = await this.page.locator('text=Detecting authentication mode').isVisible().catch(() => false);
    
    if (authDetecting) {
      console.log('🔄 NextJS hydration issue detected, reloading to fix auth detection...');
      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
      
      // Give it a moment to fully hydrate
      await this.page.waitForTimeout(1000);
      
      // Check if it's still detecting (shouldn't be after reload)
      const stillDetecting = await this.page.locator('text=Detecting authentication mode').isVisible().catch(() => false);
      if (stillDetecting) {
        console.log('⚠️ Auth detection still present after reload, continuing anyway...');
      }
    }
    
    // Wait for the specific dashboard elements to be visible with generous timeout
    try {
      await this.saveLayoutButton.waitFor({ state: 'visible', timeout: 20000 });
      await this.noFileLoadedText.waitFor({ state: 'visible', timeout: 10000 });
      await this.page.locator('text=Widgets: 0').waitFor({ state: 'visible', timeout: 10000 });
    } catch (error) {
      console.log('⚠️ Dashboard elements not found, trying one more reload...');
      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
      
      // Try again after reload
      await this.saveLayoutButton.waitFor({ state: 'visible', timeout: 15000 });
      await this.noFileLoadedText.waitFor({ state: 'visible', timeout: 10000 });
      await this.page.locator('text=Widgets: 0').waitFor({ state: 'visible', timeout: 10000 });
    }
    
    console.log('✅ Dashboard ready!');
  }

  async navigateToTab(tabName: string) {
    const tabLink = this.page.locator(`[data-testid="nav-${tabName}"], a:has-text("${tabName}")`);
    await tabLink.click();
    await this.page.waitForLoadState('networkidle');
  }

  async selectFile(fileName: string) {
    const fileItem = this.fileBrowserFiles.filter({ hasText: fileName }).first();
    await fileItem.waitFor({ state: 'visible', timeout: 10000 });
    await fileItem.click();
    
    // Wait for file selection state to propagate
    await this.page.waitForTimeout(1000);
  }

  async expectCurrentFileIndicator(fileName: string) {
    await this.currentFileIndicator.waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.currentFileIndicator).toContainText(fileName);
  }

  async expectWidgetCount(expectedCount: number) {
    await expect(this.widgets).toHaveCount(expectedCount);
  }

  async runDDA(filePath: string, channels?: string) {
    // Fill in DDA configuration
    await this.ddaFilePathInput.fill(filePath);
    
    if (channels) {
      await this.ddaChannelInput.fill(channels);
    }
    
    // Click run button
    await this.ddaRunButton.click();
    
    // Wait for processing to complete
    await this.page.waitForLoadState('networkidle');
  }

  async selectDDAVariants(variantIds: string[]) {
    for (const variantId of variantIds) {
      const checkbox = this.ddaVariantOptions.filter({ has: this.page.locator(`[value="${variantId}"]`) });
      await checkbox.check();
    }
  }

  async expectDDAResults() {
    // Wait for results to appear in plot widgets
    const hasResults = this.page.locator('[data-testid="dda-results"], .dda-results');
    await hasResults.waitFor({ state: 'visible', timeout: 30000 });
  }

  async expectPlotDataUpdate() {
    // Wait for plot widgets to show data
    const plotWithData = this.plotWidgets.filter({ has: this.page.locator('canvas, svg') });
    await expect(plotWithData).toHaveCount({ gte: 1 });
  }

  async dragWidget(widgetSelector: string, targetX: number, targetY: number) {
    const widget = this.page.locator(widgetSelector);
    const widgetBox = await widget.boundingBox();
    
    if (widgetBox) {
      await widget.dragTo(this.page.locator('body'), {
        targetPosition: { x: targetX, y: targetY }
      });
    }
  }

  async resizeWidget(widgetSelector: string, deltaWidth: number, deltaHeight: number) {
    const resizeHandle = this.page.locator(`${widgetSelector} .react-resizable-handle`);
    const handleBox = await resizeHandle.boundingBox();
    
    if (handleBox) {
      await resizeHandle.dragTo(this.page.locator('body'), {
        targetPosition: { 
          x: handleBox.x + deltaWidth, 
          y: handleBox.y + deltaHeight 
        }
      });
    }
  }
}