import { describe, expect, it } from "vitest";
import { generateJarvisReply } from "./jarvisAi";

const liveIt = process.env.RUN_GEMINI_LIVE_TEST === "1" ? it : it.skip;

describe("Gemini project secret", () => {
  liveIt("autentica no endpoint compatível e produz uma resposta curta", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey, "GEMINI_API_KEY deve estar disponível no servidor").toBeTruthy();

    const result = await generateJarvisReply([
      { role: "user", content: "Responda apenas: OK" },
    ]);

    expect(result.model).toBe("gemini-3.6-flash");
    expect(result.reply.trim()).toBeTruthy();
  }, 30_000);
});
