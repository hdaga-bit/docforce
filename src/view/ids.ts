export function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function integrationNodeId(name: string): string {
  return `ext:${sanitizeId(name)}`;
}

export function datastoreNodeId(name: string): string {
  return `store:${sanitizeId(name)}`;
}
