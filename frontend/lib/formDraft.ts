const DRAFT_PREFIX = 'procurement:draft:v1';

export function formDraftKey(userId: string, formId: string): string {
  return `${DRAFT_PREFIX}:${userId}:${formId}`;
}

export function readFormDraft<T>(userId: string, formId: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(formDraftKey(userId, formId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFormDraft<T>(userId: string, formId: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(formDraftKey(userId, formId), JSON.stringify(data));
  } catch {
    // Quota exceeded or private mode — ignore
  }
}

export function clearFormDraft(userId: string, formId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(formDraftKey(userId, formId));
  } catch {
    // ignore
  }
}
