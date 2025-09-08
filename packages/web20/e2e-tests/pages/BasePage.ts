import { Page, Locator, expect } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(path: string = '/') {
    await this.page.goto(path);
    // Don't wait for networkidle as it causes timeouts with the auth detection issue
    await this.page.waitForLoadState('domcontentloaded');
  }

  async waitForElement(selector: string, timeout: number = 10000): Promise<Locator> {
    const element = this.page.locator(selector);
    await element.waitFor({ timeout });
    return element;
  }

  async clickElement(selector: string, options?: { timeout?: number; force?: boolean }) {
    const element = await this.waitForElement(selector, options?.timeout);
    await element.click({ force: options?.force });
  }

  async fillInput(selector: string, value: string, options?: { timeout?: number }) {
    const element = await this.waitForElement(selector, options?.timeout);
    await element.clear();
    await element.fill(value);
  }

  async getText(selector: string, options?: { timeout?: number }): Promise<string> {
    const element = await this.waitForElement(selector, options?.timeout);
    return await element.textContent() || '';
  }

  async isVisible(selector: string, timeout: number = 5000): Promise<boolean> {
    try {
      const element = this.page.locator(selector);
      await element.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async waitForToast(message?: string, timeout: number = 10000): Promise<void> {
    const toastSelector = '[data-testid="toast"], .toast, [role="alert"]';
    const toast = this.page.locator(toastSelector).first();
    
    await toast.waitFor({ state: 'visible', timeout });
    
    if (message) {
      await expect(toast).toContainText(message);
    }
  }

  async waitForUrl(urlPattern: string | RegExp, timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(urlPattern, { timeout });
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  }
}