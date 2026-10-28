/** The server's own message when it sent one, otherwise a fallback. */
export function errorText(e: any, fallback = 'Something went wrong. Try again.'): string {
  if (e?.status === 0) return 'Can’t reach the MyTerra server. Make sure the backend is running.';
  const detail = e?.error?.detail;
  if (typeof detail === 'string') return detail;
  // Validation errors come as a list; show the first one in plain words.
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
}
