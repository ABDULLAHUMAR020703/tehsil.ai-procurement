import type { Request } from 'express';

export function logPoUpload(req: Request, stage: string, meta?: Record<string, unknown>): void {
  const payload = { event: 'po_upload', stage, ...meta };
  const log = (req as Request & { log?: { info: (o: unknown, msg?: string) => void } }).log;
  if (log) {
    log.info(payload, 'po_upload');
    return;
  }
  if (process.env.PO_UPLOAD_DEBUG === '1' || process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[po_upload]', payload);
  }
}
