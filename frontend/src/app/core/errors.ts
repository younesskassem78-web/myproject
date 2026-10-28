/** The server's own message when it sent one, otherwise a fallback. */
export function errorText(e: any, fallback = 'Something went wrong. Try again.'): string {
  if (e?.status === 0) return 'Can’t reach the MyTerra server. Make sure the backend is running.';
  return typeof e?.error?.detail === 'string' ? e.error.detail : fallback;
}
