import { createHash } from 'node:crypto';
import {
  ACCEPTED_CONTENT_TYPES,
  type AcceptedContentType,
  type RetentionClass,
} from './documents.types';

export const MAX_DOCUMENT_BYTES = 512 * 1024;

export type MalwareVerdict = 'CLEAN' | 'INFECTED' | 'UNAVAILABLE';

/**
 * Virus-scan hook. Deployed environments plug in the managed scanner; every
 * upload passes through it before extraction, and an unavailable scanner
 * fails closed.
 */
export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Uint8Array): Promise<MalwareVerdict>;
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Signature scanner for local and fixture runs; detects the EICAR test file. */
export class SignatureMalwareScanner implements MalwareScanner {
  readonly name = 'signature-local-1';

  async scan(bytes: Uint8Array): Promise<MalwareVerdict> {
    return Buffer.from(bytes).toString('latin1').includes(EICAR) ? 'INFECTED' : 'CLEAN';
  }
}

export type UploadRejection =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'BAD_ENCODING'
  | 'UNSUPPORTED_TYPE'
  | 'TYPE_MISMATCH'
  | 'MALWARE'
  | 'SCAN_UNAVAILABLE';

export class UploadRejectedError extends Error {
  constructor(readonly reason: UploadRejection) {
    super(`Upload rejected: ${reason}`);
    this.name = 'UploadRejectedError';
  }
}

const EXTENSIONS: Record<AcceptedContentType, readonly string[]> = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
};

const BINARY_MAGIC = ['%PDF', 'PK\u0003\u0004', 'MZ', '\u007fELF', 'ÐÏ\u0011à'];

/** Strip any path and unsafe characters from a client-supplied file name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replaceAll(/[^A-Za-z0-9 ._()-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200);
  return cleaned.trim() || 'document.txt';
}

export interface ValidatedUpload {
  readonly fileName: string;
  readonly contentType: AcceptedContentType;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly sha256: string;
}

/**
 * Validate type, size, encoding and content before anything is stored:
 * declared type and extension must agree, binary content is refused, text
 * must be valid UTF-8, and the malware hook must report clean.
 */
export async function validateUpload(
  input: { fileName: string; contentType: string; contentBase64: string },
  scanner: MalwareScanner,
): Promise<ValidatedUpload> {
  if (!(ACCEPTED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new UploadRejectedError('UNSUPPORTED_TYPE');
  }
  const contentType = input.contentType as AcceptedContentType;
  const fileName = safeFileName(input.fileName);
  if (!EXTENSIONS[contentType].some((ext) => fileName.toLowerCase().endsWith(ext))) {
    throw new UploadRejectedError('TYPE_MISMATCH');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) {
    throw new UploadRejectedError('BAD_ENCODING');
  }
  const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
  if (bytes.length === 0) throw new UploadRejectedError('EMPTY');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new UploadRejectedError('TOO_LARGE');
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  if (BINARY_MAGIC.some((magic) => head.startsWith(magic)) || bytes.includes(0)) {
    throw new UploadRejectedError('TYPE_MISMATCH');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UploadRejectedError('BAD_ENCODING');
  }
  const verdict = await scanner.scan(bytes);
  if (verdict === 'INFECTED') throw new UploadRejectedError('MALWARE');
  if (verdict !== 'CLEAN') throw new UploadRejectedError('SCAN_UNAVAILABLE');
  return {
    fileName,
    contentType,
    bytes,
    text,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const DAY_MS = 86_400_000;

/** Retention: short-lived documents expire after 90 days; legal hold never expires. */
export function retainUntil(retentionClass: RetentionClass, now: Date): string | null {
  return retentionClass === 'SHORT_90D'
    ? new Date(now.getTime() + 90 * DAY_MS).toISOString()
    : null;
}

export function retentionExpired(
  document: { retentionClass: RetentionClass; retainUntil: string | null },
  now: Date,
): boolean {
  return (
    document.retentionClass !== 'LEGAL_HOLD' &&
    document.retainUntil !== null &&
    Date.parse(document.retainUntil) <= now.getTime()
  );
}
