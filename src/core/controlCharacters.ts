/** Reject ASCII controls without normalizing or changing the original input. */
export function hasAsciiControl(value: string): boolean {
  return Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
