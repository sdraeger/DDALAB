// Browser-compatible shell utilities for renderer process
// This provides a minimal interface since renderer process doesn't execute shell commands directly

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code?: number;
}

class BrowserShellUtility {
  /**
   * Placeholder for browser environment - shell operations not available
   */
  async detectShell(): Promise<string> {
    throw new Error('Shell operations not available in browser environment');
  }

  async getExecOptions(additionalOptions: any = {}): Promise<any> {
    throw new Error('Shell operations not available in browser environment');
  }

  async execCommand(command: string, options: any = {}): Promise<ExecResult> {
    throw new Error('Shell operations not available in browser environment');
  }

  exec(command: string, options: any, callback: Function): void {
    throw new Error('Shell operations not available in browser environment');
  }

  getCurrentShell(): string | null {
    return null;
  }

  resetDetection(): void {
    // No-op in browser
  }

  isWindows(): boolean {
    // Best guess based on user agent
    return navigator.userAgent.indexOf('Windows') !== -1;
  }

  getCommandSeparator(): string {
    return this.isWindows() ? ' && ' : ' && ';
  }

  escapeShellArg(arg: string): string {
    // Basic escaping for display purposes
    return arg.includes(' ') ? `"${arg}"` : arg;
  }
}

// Export singleton instance
export const shellUtils = new BrowserShellUtility();

// Export class for consistency
export { BrowserShellUtility as ShellUtility };