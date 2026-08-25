type ApiErrorShape = {
  data?: { code?: string };
  message?: string;
};

export function isProviderQuotaError(error: unknown) {
  const candidate = error as ApiErrorShape | null;
  return candidate?.data?.code === "TOO_MANY_REQUESTS" || /limite de uso do provedor|quota/i.test(candidate?.message || "");
}

export function shouldReportApiError(error: unknown) {
  return !isProviderQuotaError(error);
}
