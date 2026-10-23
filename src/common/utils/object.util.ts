/** Copie d'un objet sans certaines clés. */
export function omit<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Omit<T, K> {
  const removed = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !removed.has(key))) as Omit<
    T,
    K
  >;
}
