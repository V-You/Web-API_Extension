const DASHBOARD_HOST_PATTERNS = [
  /(^|\.)oppwa\.com$/i,
  /(^|\.)ctpe\.info$/i,
  /(^|\.)prtpe\.com$/i,
] as const;

export function isSupportedDashboardHost(hostname: string): boolean {
  return DASHBOARD_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function isSupportedDashboardUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && isSupportedDashboardHost(url.hostname);
  } catch {
    return false;
  }
}