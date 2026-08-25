import { describe, expect, it } from "vitest";
import { buildTextRequestContext } from "./chatRetryPolicy";

describe("chat retry policy", () => {
  it("adds a new text request to the contextual history", () => {
    expect(buildTextRequestContext([{ role: "assistant", content: "Olá" }], "Organize meu dia", false)).toEqual([
      { role: "assistant", content: "Olá" },
      { role: "user", content: "Organize meu dia" },
    ]);
  });

  it("reuses existing context on retry without duplicating the last request", () => {
    const history = [{ role: "user" as const, content: "Organize meu dia" }];
    expect(buildTextRequestContext(history, "Organize meu dia", true)).toEqual(history);
  });
});
