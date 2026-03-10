"use client";

export const OPEN_SETTINGS_SECTION_EVENT = "ddalab:open-settings-section";
export const REPLAY_ONBOARDING_EVENT = "ddalab:replay-onboarding";

export interface OpenSettingsSectionDetail {
  sectionId: string;
}

let pendingSettingsSectionId: string | null = null;

export function createOpenSettingsSectionEvent(sectionId: string) {
  return new CustomEvent<OpenSettingsSectionDetail>(
    OPEN_SETTINGS_SECTION_EVENT,
    {
      detail: { sectionId },
    },
  );
}

export function requestSettingsSection(sectionId: string): void {
  pendingSettingsSectionId = sectionId;

  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(createOpenSettingsSectionEvent(sectionId));
}

export function consumePendingSettingsSection(): string | null {
  const sectionId = pendingSettingsSectionId;
  pendingSettingsSectionId = null;
  return sectionId;
}

export function createReplayOnboardingEvent() {
  return new CustomEvent(REPLAY_ONBOARDING_EVENT);
}

export function requestOnboardingReplay(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(createReplayOnboardingEvent());
}
