'use client';

import { useCallback, useEffect, useRef } from 'react';
import { clearFormDraft, readFormDraft, writeFormDraft } from '@/lib/formDraft';

type UseFormDraftOptions<T> = {
  /** Fields that must never be written to browser storage (e.g. passwords). */
  exclude?: (keyof T)[];
  debounceMs?: number;
  enabled?: boolean;
};

/**
 * Persist non-sensitive form fields per user. Permissions/roles are re-validated server-side on submit.
 */
export function useFormDraft<T extends Record<string, unknown>>(
  formId: string,
  userId: string | undefined | null,
  values: T,
  options?: UseFormDraftOptions<T>,
) {
  const { exclude = [], debounceMs = 600, enabled = true } = options ?? {};
  const restoredRef = useRef(false);

  const clear = useCallback(() => {
    if (!userId) return;
    clearFormDraft(userId, formId);
  }, [userId, formId]);

  const restore = useCallback((): Partial<T> | null => {
    if (!userId) return null;
    return readFormDraft<Partial<T>>(userId, formId);
  }, [userId, formId]);

  useEffect(() => {
    if (!enabled || !userId || restoredRef.current) return;
    restoredRef.current = true;
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const payload = { ...values } as Record<string, unknown>;
    for (const key of exclude) delete payload[key as string];

    const hasContent = Object.values(payload).some((v) => {
      if (v === null || v === undefined || v === '') return false;
      if (typeof v === 'number' && v === 0) return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });
    if (!hasContent) return;

    const timer = window.setTimeout(() => {
      writeFormDraft(userId, formId, payload as T);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [enabled, userId, formId, values, exclude, debounceMs]);

  return { restore, clear };
}
