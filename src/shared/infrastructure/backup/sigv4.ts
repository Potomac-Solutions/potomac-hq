// AWS Signature Version 4, for Cloudflare R2's S3 API. Only what a single
// signed PUT or GET needs: no query-string signing, no chunked uploads.
import { createHash, createHmac } from "node:crypto";

export type SignInput = {
  readonly method: string;
  readonly url: URL;
  /** Every header to sign, names in any case. `host` is added from the URL. */
  readonly headers: Readonly<Record<string, string>>;
  /** The hex SHA-256 of the body, also sent as x-amz-content-sha256. */
  readonly payloadHash: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
  /** YYYYMMDDTHHMMSSZ, also sent as x-amz-date. */
  readonly amzDate: string;
};

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding of each path segment, keeping the slashes. */
function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** The Authorization header value. */
export function authorization(input: SignInput): string {
  const headers: Record<string, string> = { host: input.url.host };
  for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const query = [...input.url.searchParams]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [input.method, canonicalPath(input.url.pathname), query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");

  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
}

/** YYYYMMDDTHHMMSSZ for an instant. */
export function amzDate(instant: string): string {
  return instant.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}
