/** The server's own message when it sent one, otherwise a fallback. */
export function errorText(e: any, fallback = 'Something went wrong. Try again.'): string {
  // 0 = no connection; 502-504 = the proxy (dev server or nginx) couldn't reach the API.
  if (e?.status === 0 || [502, 503, 504].includes(e?.status)) return 'Can’t reach the MyTerra server right now. Try again in a moment.';
  const detail = e?.error?.detail;
  if (typeof detail === 'string') return detail;
  // Validation errors come as a list; show the first one in plain words.
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
}
