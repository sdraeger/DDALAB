// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingSettingsSection,
  createOpenSettingsSectionEvent,
  createReplayOnboardingEvent,
  OPEN_SETTINGS_SECTION_EVENT,
  REPLAY_ONBOARDING_EVENT,
  requestOnboardingReplay,
  requestSettingsSection,
} from "@/lib/appNavigationEvents";

describe("appNavigationEvents", () => {
  afterEach(() => {
    consumePendingSettingsSection();
  });

  it("dispatches and stores pending settings section requests", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);

    requestSettingsSection("security");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      (listener.mock.calls[0][0] as CustomEvent<{ sectionId: string }>).detail,
    ).toEqual({
      sectionId: "security",
    });
    expect(consumePendingSettingsSection()).toBe("security");
    expect(consumePendingSettingsSection()).toBeNull();

    window.removeEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);
  });

  it("creates settings section events with the expected detail", () => {
    const event = createOpenSettingsSectionEvent("updates");

    expect(event.type).toBe(OPEN_SETTINGS_SECTION_EVENT);
    expect(event.detail).toEqual({ sectionId: "updates" });
  });

  it("dispatches onboarding replay requests", () => {
    const listener = vi.fn();
    window.addEventListener(REPLAY_ONBOARDING_EVENT, listener);

    requestOnboardingReplay();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBeInstanceOf(CustomEvent);

    window.removeEventListener(REPLAY_ONBOARDING_EVENT, listener);
  });

  it("creates onboarding replay events with the expected name", () => {
    const event = createReplayOnboardingEvent();

    expect(event.type).toBe(REPLAY_ONBOARDING_EVENT);
  });
});
