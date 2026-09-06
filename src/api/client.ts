import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

export const TOKEN_KEY = 'shelfstock_jwt';

export class ApiError extends Error {
  /**
   * `body` is the parsed error body when the server sent JSON, `{}` otherwise.
   * A 409 from adjust-stock carries `{ error, stock }` - the count it refused
   * against - so the stepper can land on the server's number without a refetch.
   */
  constructor(
    public status: number,
    message: string,
    public body: unknown = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) onUnauthorized?.();

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body);
  }
  return (await res.json()) as T;
}
