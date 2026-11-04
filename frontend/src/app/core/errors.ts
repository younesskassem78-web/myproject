import { t } from './i18n';

/** The server's own message when it sent one (translated when we know it), otherwise a fallback. */
export function errorText(e: any, fallback = 'Something went wrong. Try again.'): string {
  const detail = e?.error?.detail;
  // The API's own explanation wins, even for 502 ("We couldn't send the email…").
  if (typeof detail === 'string') return t(detail);
  // 0 = no connection; 502-504 without a message = the proxy (dev server or nginx) couldn't reach the API.
  if (e?.status === 0 || [502, 503, 504].includes(e?.status)) return t('Can’t reach the MyTerra server right now. Try again in a moment.');
  // Validation errors come as a list; show the first one in plain words.
  const first = Array.isArray(detail) ? detail[0] : null;
  if (first?.msg === 'Field required') return t('{field} is missing.', { field: fieldName(first.loc) });
  if (first?.msg) return t(String(first.msg).replace(/^Value error, /, ''));
  return t(fallback);
}

/** ["body", "birth_date"] -> "Birth date" */
function fieldName(loc: unknown): string {
  const last = Array.isArray(loc) ? String(loc[loc.length - 1]) : 'A field';
  const words = last.replace(/_id$/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
