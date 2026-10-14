export function compareVersions(left: string, right: string): number {
  const parsedLeft = semanticParts(left);
  const parsedRight = semanticParts(right);
  const a = parsedLeft?.numbers ?? numericParts(left);
  const b = parsedRight?.numbers ?? numericParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  // Preserve historical handling of non-semantic version strings.
  if (!parsedLeft || !parsedRight) return 0;
  const preA = parsedLeft.prerelease;
  const preB = parsedRight.prerelease;
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  for (let index = 0; index < Math.min(preA.length, preB.length); index += 1) {
    const difference = compareIdentifier(preA[index]!, preB[index]!);
    if (difference !== 0) return difference;
  }
  return preA.length - preB.length;
}

export function versionAtLeast(current: string, minimum: string): boolean {
  return compareVersions(current, minimum) >= 0;
}

function semanticParts(value: string): { numbers: number[]; prerelease: string[] | undefined } | null {
  const match = /^[vV]?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim());
  if (!match) return null;
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)], prerelease: match[4]?.split(".") };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    // Compare numeric identifiers without precision loss for long build counters.
    const a = left.replace(/^0+(?=\d)/, "");
    const b = right.replace(/^0+(?=\d)/, "");
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function numericParts(value: string): number[] {
  return value.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}
