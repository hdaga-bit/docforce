export function unifiedDiff(oldText: string, newText: string, path: string): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const header = [`--- a/${path}`, `+++ b/${path}`];
  if (oldText === newText) {
    return header.join("\n") + "\n";
  }
  const ops = lcsOps(a, b);
  const body = ["@@ section @@"];
  for (const op of ops) {
    if (op.type === "equal") body.push(` ${op.line}`);
    else if (op.type === "del") body.push(`-${op.line}`);
    else body.push(`+${op.line}`);
  }
  return [...header, ...body, ""].join("\n");
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

type Op = { type: "equal" | "del" | "add"; line: string };

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? (dp[i + 1]![j + 1]! + 1)
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! });
      i += 1;
    } else {
      ops.push({ type: "add", line: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", line: a[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", line: b[j]! });
    j += 1;
  }
  return ops;
}
