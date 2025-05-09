declare global {
  interface Window {
    electron: {
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
      };
      auth: {
        login: (credentials: {
          email: string;
          password: string;
        }) => Promise<{ success: boolean }>;
        logout: () => Promise<{ success: boolean }>;
      };
    };
  }
}
