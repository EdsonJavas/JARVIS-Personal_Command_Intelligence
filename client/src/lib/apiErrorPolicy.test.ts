import { describe, expect, it } from "vitest";
import { isProviderQuotaError, shouldReportApiError } from "./apiErrorPolicy";

describe("provider quota error policy", () => {
  it("recognizes the tRPC quota code as an expected recoverable error", () => {
    const error = { data: { code: "TOO_MANY_REQUESTS" }, message: "quota exceeded" };
    expect(isProviderQuotaError(error)).toBe(true);
    expect(shouldReportApiError(error)).toBe(false);
  });

  it("recognizes the localized provider quota message", () => {
    expect(isProviderQuotaError({ message: "O limite de uso do provedor foi atingido." })).toBe(true);
  });

  it("keeps unexpected API failures reportable", () => {
    expect(shouldReportApiError({ data: { code: "BAD_GATEWAY" }, message: "Falha inesperada" })).toBe(true);
  });
});
