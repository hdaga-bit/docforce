export type EnvArea =
  | "service URLs"
  | "ports"
  | "credentials"
  | "timeouts"
  | "audio/device"
  | "watchdog/operations"
  | "runtime";

export function classifyEnvVar(name: string): EnvArea {
  if (/(WATCHDOG|SUPERVISOR|REBOOT|GUARD)/i.test(name)) return "watchdog/operations";
  if (/(ALSA|MIC|AUDIO|CAMERA|UDEV)/i.test(name)) return "audio/device";
  if (/_(URL|HOST|ENDPOINT|BASE_URL|BASEURL)$/i.test(name) || /^(URL|HOST)$/i.test(name)) {
    return "service URLs";
  }
  if (/_PORT$/i.test(name) || /^PORT$/i.test(name)) return "ports";
  if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PEPPER|CREDENTIAL|SERVICE_ACCOUNT)/i.test(name)) {
    return "credentials";
  }
  if (/(TIMEOUT|WAIT|INTERVAL|COOLDOWN|GRACE|_MS$|_SEC$)/i.test(name)) return "timeouts";
  return "runtime";
}

export function envAreas(names: readonly string[]): EnvArea[] {
  const seen = new Set<EnvArea>();
  for (const name of names) seen.add(classifyEnvVar(name));
  return [...seen];
}

export function parseEnvNamesFromDetail(detail?: string): string[] {
  if (!detail) return [];
  const match = detail.match(/env ([^;]+)/);
  if (!match) return [];
  return match[1]!.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

export function summarizeEnvNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  const areas = envAreas(names);
  const areaText = areas.length > 0 ? ` (${areas.join(", ")})` : "";
  return `${names.length} environment variable${names.length === 1 ? "" : "s"}${areaText}`;
}

export function summarizeComposeDetail(detail?: string): string {
  if (!detail) return "";
  const names = parseEnvNamesFromDetail(detail);
  if (names.length === 0) return detail;
  const summary = summarizeEnvNames(names);
  return detail.replace(/env [^;]+/, summary);
}
