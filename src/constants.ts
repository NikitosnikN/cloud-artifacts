export const UPLOAD_PATH = "/api/artifacts";
export const OBJECT_PREFIX = "artifacts/";

export const UUID_PATH = /^\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.html)?$/;

export function artifactKey(id: string): string {
  return `${OBJECT_PREFIX}${id}.html`;
}
