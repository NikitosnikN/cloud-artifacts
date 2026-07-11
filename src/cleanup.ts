import { OBJECT_PREFIX } from "./constants";
import { parseExpiresAt } from "./parsing";

export type CleanupResult = { scanned: number; deleted: number };

export async function cleanupExpired(env: Env, now: number): Promise<CleanupResult> {
  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  do {
    const page = await env.ARTIFACTS.list({
      prefix: OBJECT_PREFIX,
      cursor,
      limit: 1000,
      include: ["customMetadata"],
    });
    scanned += page.objects.length;
    const keys = page.objects.filter((object) => {
      const expiresAt = parseExpiresAt(object.customMetadata?.expiresAt);
      return expiresAt !== null && expiresAt <= now;
    }).map((object) => object.key);
    if (keys.length > 0) {
      await env.ARTIFACTS.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { scanned, deleted };
}
