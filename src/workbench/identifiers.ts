export function remoteScope(operation: string, value: string): string {
  let hash = 2166136261;
  const input = `${operation}\u0000${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${operation}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
