export const UPLOAD_PATH = "/api/artifacts";
export const OBJECT_PREFIX = "artifacts/";

export const UUID_PATH = /^\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.html)?$/;

/** Named docs: a permanent link whose content is the doc's current version. */
export const DOC_PREFIX = "docs/";
export const DOCS_API_PATH = "/api/docs";
/** /api/docs/{name} and /api/docs/{name}/rollback */
export const DOC_API_PATH = /^\/api\/docs\/([^/]+)(\/rollback)?$/;
/** /d/{name}, /d/{name}/v/{n} and /d/{name}/history */
export const DOC_PAGE_PATH = /^\/d\/([^/]+)(?:\/v\/([1-9]\d{0,8})|\/(history))?\/?$/;

export function artifactKey(id: string): string {
  return `${OBJECT_PREFIX}${id}.html`;
}

export function docKey(name: string): string {
  return `${DOC_PREFIX}${name}.json`;
}
