const FILE_HOSTS = new Set([
  "catbox.moe",
  "litterbox.catbox.moe",
  "0x0.st",
  "file.io",
  "tmpfiles.org",
  "transfer.sh",
  "pastebin.com",
]);

const EMAIL_HOSTS = new Set([
  "api.resend.com",
  "api.brevo.com",
  "api.emailjs.com",
  "api.sendgrid.com",
  "api.mailgun.net",
  "api.postmarkapp.com",
]);

export type IntegrationFamily = "file-host" | "email-api" | "ungrouped";

export interface IntegrationGroup {
  readonly family: IntegrationFamily;
  readonly id: string;
  readonly label: string;
  readonly members: readonly string[];
}

export function integrationFamily(name: string): IntegrationFamily {
  const host = name.toLowerCase();
  if (FILE_HOSTS.has(host)) return "file-host";
  if (EMAIL_HOSTS.has(host)) return "email-api";
  return "ungrouped";
}

export function familyGroupId(family: Exclude<IntegrationFamily, "ungrouped">): string {
  return `ext-group:${family}`;
}

export function familyGroupLabel(family: Exclude<IntegrationFamily, "ungrouped">, count: number): string {
  switch (family) {
    case "file-host":
      return `File-host APIs (${count})`;
    case "email-api":
      return `Email APIs (${count})`;
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export function groupIntegrations(names: readonly string[]): IntegrationGroup[] {
  const buckets = new Map<IntegrationFamily, string[]>();
  for (const name of names) {
    const family = integrationFamily(name);
    const list = buckets.get(family) ?? [];
    list.push(name);
    buckets.set(family, list);
  }

  const groups: IntegrationGroup[] = [];
  for (const family of ["file-host", "email-api", "ungrouped"] as const) {
    const members = buckets.get(family) ?? [];
    if (members.length === 0) continue;
    if (family === "ungrouped" || members.length < 2) {
      for (const member of members) {
        groups.push({
          family: "ungrouped",
          id: member,
          label: member,
          members: [member],
        });
      }
      continue;
    }
    groups.push({
      family,
      id: familyGroupId(family),
      label: familyGroupLabel(family, members.length),
      members,
    });
  }
  return groups;
}

export function groupedTargetId(
  nodeId: string,
  groups: readonly IntegrationGroup[],
): string {
  if (!nodeId.startsWith("ext:")) return nodeId;
  const slug = nodeId.slice(4);
  for (const group of groups) {
    if (group.family === "ungrouped") continue;
    if (group.members.some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === slug)) {
      return group.id;
    }
  }
  return nodeId;
}
