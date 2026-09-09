export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly reason: string };
export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(reason: string): Err {
  return { ok: false, reason };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok;
}
