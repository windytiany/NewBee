export function formatPathForDisplay(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  if (path.startsWith("\\\\?\\") && /^[A-Za-z]:[\\/]/.test(path.slice(4))) {
    return path.slice(4);
  }
  return path;
}
