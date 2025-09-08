import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly loginForm = this.page.locator('[data-testid="login-form"]');
  readonly usernameInput = this.page.locator('input[name="username"], input[type="email"]');
  readonly passwordInput = this.page.locator('input[name="password"], input[type="password"]');
  readonly loginButton = this.page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
  readonly errorMessage = this.page.locator('[data-testid="error-message"], .error, [role="alert"]');

  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/login');
    await this.waitForLoginForm();
  }

  async waitForLoginForm() {
    await this.loginForm.waitFor({ state: 'visible', timeout: 15000 });
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async expectLoginError(message?: string) {
    await this.errorMessage.waitFor({ state: 'visible', timeout: 10000 });
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  async expectSuccessfulLogin() {
    // Wait for redirect away from login page
    await this.page.waitForFunction(
      () => !window.location.pathname.includes('/login'),
      undefined,
      { timeout: 15000 }
    );
  }
}