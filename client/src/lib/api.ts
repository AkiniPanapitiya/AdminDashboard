export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Json = Record<string, unknown> | unknown[];

let onUnauthorized: (() => void) | undefined;
/** Lets the auth layer react when the server says the session is gone. */
export function setUnauthorizedHandler(handler: (() => void) | undefined) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options: { method?: string; body?: Json } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'network');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page).
  }

  if (!response.ok) {
    const error = (
      payload as { error?: { message?: string; code?: string; details?: { message: string }[] } } | null
    )?.error;
    if (response.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.();
    const detail = error?.details?.[0]?.message;
    const message =
      response.status === 429
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : response.status >= 500
          ? 'The server had a problem. Please try again.'
          : detail
            ? `${error?.message ?? 'Invalid request'}: ${detail}`
            : (error?.message ?? `Request failed (${response.status})`);
    throw new ApiError(response.status, message, error?.code);
  }
  return payload as T;
}

// ---- API shapes ----

export interface User {
  id: string;
  email: string;
  role: 'owner';
}
export interface Staff {
  id: string;
  fullName: string;
  phone: string | null;
  active: boolean;
}
export interface JobType {
  id: string;
  name: string;
  rateCents: number;
  active: boolean;
}
export interface ProductionEntry {
  id: string;
  staffId: string;
  staffName: string;
  jobTypeName: string;
  quantity: number;
  rateCents: number;
  lineTotalCents: number;
  workDate: string;
  note: string | null;
}
export interface PayrollLine {
  staffId: string;
  fullName: string;
  active: boolean;
  pieces: number;
  grossCents: number;
  bonusCents: number;
  advanceCents: number;
  deductionCents: number;
  netCents: number;
}
export interface PayrollSummary {
  month: string;
  lines: PayrollLine[];
  totals: Omit<PayrollLine, 'staffId' | 'fullName' | 'active'>;
}
export interface Adjustment {
  id: string;
  staffId: string;
  staffName: string;
  month: string;
  kind: 'bonus' | 'advance' | 'deduction';
  amountCents: number;
  note: string | null;
}
export interface StaffPayrollDetail {
  month: string;
  summary: PayrollLine;
  breakdown: { jobTypeName: string; rateCents: number; pieces: number; totalCents: number }[];
  adjustments: Adjustment[];
}
