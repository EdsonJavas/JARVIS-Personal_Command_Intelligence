import { describe, expect, it } from "vitest";
import { shouldSpeakChatReply } from "./chatResponsePolicy";

describe("chat response speech policy", () => {
  it("speaks only when the user enables it and the required voice is available", () => {
    expect(shouldSpeakChatReply({ enabled: true, canSpeak: true, hasVoice: true })).toBe(true);
  });

  it("keeps the response in text when speech is disabled or unavailable", () => {
    expect(shouldSpeakChatReply({ enabled: false, canSpeak: true, hasVoice: true })).toBe(false);
    expect(shouldSpeakChatReply({ enabled: true, canSpeak: false, hasVoice: true })).toBe(false);
    expect(shouldSpeakChatReply({ enabled: true, canSpeak: true, hasVoice: false })).toBe(false);
  });
});
