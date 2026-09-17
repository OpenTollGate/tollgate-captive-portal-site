const BASE_URL = import.meta.env.BASE_URL;

export function withBase(path: string): string {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_URL}${normalizedPath}`;
}

export function trimTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}
