export interface UserPreferences {
  theme: "light" | "dark" | "system";
  eeg_zoom_factor: number;
}

export interface UserPreferencesUpdate {
  theme?: "light" | "dark" | "system";
  eeg_zoom_factor?: number;
}
