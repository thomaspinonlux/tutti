/**
 * Wrapper fetch pour appeler notre backend API.
 *
 * - Ajoute automatiquement le header Authorization avec le JWT Supabase
 * - Sérialise/désérialise JSON
 * - Lève une erreur typée si la réponse n'est pas 2xx
 */

import { supabase } from './supabase.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Si true, n'inclut pas le header Authorization (endpoint public). */
  anonymous?: boolean;
}

async function buildHeaders(anonymous: boolean | undefined): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (!anonymous) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, anonymous, headers: customHeaders, ...rest } = opts;
  const headers = {
    ...(await buildHeaders(anonymous)),
    ...(customHeaders as Record<string, string>),
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errPayload =
      typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error: { code?: string; message?: string; details?: unknown } }).error
        : undefined;
    throw new ApiError(
      response.status,
      errPayload?.code ?? `HTTP_${response.status}`,
      errPayload?.message ?? `HTTP ${response.status}`,
      errPayload?.details,
    );
  }

  return data as T;
}
