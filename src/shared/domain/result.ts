// Domain functions answer with a code, not a sentence and not an exception.
// The caller decides the words. (Same convention as the Potomac kit.)

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E extends string> = { readonly ok: false; readonly error: E };
export type Result<T, E extends string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E extends string>(error: E): Err<E> {
  return { ok: false, error };
}
