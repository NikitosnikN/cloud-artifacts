import { json } from "./http";

export function requireAllowedIp(request: Request, allowedIps: readonly string[]): Response | null {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (allowedIps.includes("*")) return null;
  if (clientIp && allowedIps.includes(clientIp)) return null;
  return json({ error: "Source IP is not allowed" }, 403);
}
