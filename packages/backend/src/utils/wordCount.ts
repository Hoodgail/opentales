export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
