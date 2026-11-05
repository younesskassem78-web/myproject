import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, catchError, retry, throwError, timeout, timer } from 'rxjs';

export const READ_TIMEOUT_MS = 30_000;
const RETRIES = 2;
/** No connection (0), request timeout (408), or the proxy couldn't reach the API (502-504): worth another try. */
const TRANSIENT = [0, 408, 502, 503, 504];

/** 1 s, then 2 s, each ± 50 % so many phones coming back online don't all retry at the same instant. */
export const backoffMs = (attempt: number, random = Math.random) => 1000 * 2 ** (attempt - 1) * (0.5 + random());

/**
 * Weak-connection safety for reads only. GETs give up after 30 s (instead of hanging on a dead link)
 * and retry twice on a dropped connection. Payments, sign-ups and every other write are never retried
 * or timed out here: repeating them could double-charge, and the server may still finish them.
 */
export const resilienceInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') return next(req);
  return next(req).pipe(
    timeout(READ_TIMEOUT_MS),
    // A timeout reads as "no connection" (status 0), so errorText() shows the can't-reach-the-server message.
    catchError(e => throwError(() => e instanceof TimeoutError ? new HttpErrorResponse({ status: 0, url: req.url }) : e)),
    retry({
      count: RETRIES,
      delay: (e, attempt) => TRANSIENT.includes(e?.status) ? timer(backoffMs(attempt)) : throwError(() => e),
    }),
  );
};
