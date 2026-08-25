import { describe, expect, it } from "vitest";
import { shouldSubmitComposer } from "./chatComposer";

describe("chat composer keyboard behavior", () => {
  it("submits a non-empty message with Enter", () => {
    expect(shouldSubmitComposer({ key: "Enter", shiftKey: false, hasMessage: true, isPending: false })).toBe(true);
  });

  it("keeps a line break available with Shift+Enter", () => {
    expect(shouldSubmitComposer({ key: "Enter", shiftKey: true, hasMessage: true, isPending: false })).toBe(false);
  });

  it("does not submit empty or pending messages", () => {
    expect(shouldSubmitComposer({ key: "Enter", shiftKey: false, hasMessage: false, isPending: false })).toBe(false);
    expect(shouldSubmitComposer({ key: "Enter", shiftKey: false, hasMessage: true, isPending: true })).toBe(false);
  });
});
