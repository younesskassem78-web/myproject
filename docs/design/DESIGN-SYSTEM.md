# MyTerra design system

One stylesheet, `frontend/src/styles.scss`, styles every page. Pages use its shared classes; there are no
per-page colour or size values. Dark mode works by redefining the same variables under `[data-theme='dark']`.

## Tokens (top of styles.scss)
| Group | Variables | Rule |
|---|---|---|
| Colour | `--bg --surface --surface-2 --ink --muted --line --pine --pine-deep --amber` + status pairs (`--ok-bg/--ok-ink`, `--warn-*`, `--info-*`, `--danger*`) | Never write a hex colour in a rule; add a variable if one is missing |
| Text on dark panels | `--on-dark` | For the always-dark pine headers and panels |
| Corners | `--radius-sm` 8px (inputs) · `--radius-md` 12px (inner boxes, menus) · `--radius` 16px (cards) · `--radius-lg` 22px (dialogs, photos) · `999px` (pills, buttons) | Pick from the scale |
| Elevation | `--shadow` (cards) · `--shadow-pop` (menus, popovers) | Dark mode turns `--shadow` off and relies on borders |
| Motion | `--ease` (160 ms) | Hover/press/focus only; long animations respect `prefers-reduced-motion` |
| Type | `--display` (Bricolage Grotesque, headings, numbers, buttons) · `--text` (Source Sans 3) · IBM Plex Sans Arabic for `[lang=ar]` | |

## Shared building blocks
- **Buttons:** `.btn` + one of `-amber` (main call to action), `-ghost`, `-danger`, `-ghost-light` (on dark), and `-sm`.
  Disabled = 50 % opacity; loading = `.btn.loading` spinner; press moves 1px.
- **Surfaces:** `.card` (stacked cards get a 1.5rem gap; grids space their own children), `.panel-dark` (the one highlighted card per page).
- **Status:** `.status status-<state>` pills, `.notice` (success), `.error` (role="alert"), `.banner banner-warn`.
- **Loading:** `.skeleton`. **Empty lists:** a muted row/line saying what's missing.
- **Tables:** inside `.table-wrap` (scrolls sideways on small screens, keyboard-reachable); row buttons in `td.actions` wrap.
- **Dialogs:** native `<dialog>` (`dialog.pay`), page behind stops scrolling.
- **Angular components:** `app-icon`, `app-lang-switch`, `app-notification-bell`, `app-two-factor-card`, `app-public-header`.

## Alignment
One rule everywhere: **things that belong together stack, left-aligned, in reading order.** Side-by-side is only for
a set of equals (cards in a grid, buttons in an action row, columns of a table or data row).
- **Page header** (`.page-head`): title, then its explanation, then its tools (search, main button), all on the left.
- **Fields:** label above the field, always, filters included (`.inline-label` is the same stacked label).
- **Forms:** fields first; the buttons together underneath in a `.row-actions` row (inside `.inline-form` it spans the full width).
- **Cards:** heading, text, then the action button below the text (`.card p + .btn` adds the gap).
- **Banners:** icon, message, and the link underneath the message, lined up with its text.
- **Detail pages:** the back link on its own line, the page's actions under it.
- **Data rows** (tables, payment history, devices, tickets) keep the value, status or row action at the end of the row,
  in the same place on every row.
- **Phones:** grids collapse to one column; tables keep natural column widths and scroll inside their box.

## Loading, errors and weak connections
Every section that loads data has exactly three states, never an endless spinner:
1. **Loading:** `<app-skeleton kind="…">` (`dashboard`, `cards`, `detail`, `rows`, `lines`), built from the real layout
   classes so nothing jumps when data arrives. Announced to screen readers as "Loading…".
2. **Failed:** `<app-load-error [message] (retry)>`: the reason (from `errorText()`) and a **Try again** button.
   Keep a separate `loadError` signal when the page also has action errors, so "Try again" only re-loads.
3. **Loaded / empty:** the data, or a plain sentence saying what's missing.

- **Buttons** doing work: `[disabled]="busy()" [class.loading]="busy()"`. The label stays (invisible) so the button keeps
  its size, a spinner in the variant's colour (`--spin`) sits on top, clicks are blocked. Errors keep the form filled in.
- **Network** (`core/resilience.ts`): reads (GET) time out after 30 s and retry twice on a dropped connection or
  502-504, waiting 1 s then 2 s (±50 % jitter). **Writes are never retried or timed out**: a repeated payment or
  sign-up could double-charge, and the server may still finish it.
- **Offline:** `<app-offline-banner>` (in `App`) says when the connection drops and when it's back; pages keep what they showed.
- **Page changes:** a thin top bar (`.nav-progress`) appears only if a page takes over 150 ms to arrive (a lazy page on a
  slow link). It slides; it never shows a fake percentage.
- **Images:** fixed `width`/`height`, `loading="lazy"` below the fold, a tinted frame until they arrive, hidden if broken.
- Tested in `frontend/e2e/round4-loading.spec.ts` (slow server, server errors, dropped connection, offline, failed and
  repeated writes, slow page change, empty and 400-row lists, 600 ms latency on every page).

## Decisions (2026-11-05 frontend review)
- **Kept the existing look rather than redesigning.** A full audit (every route at 1366 px and 390 px, before/after
  screenshots via `frontend/scripts/shots.mjs`) found one consistent visual language already. The fixes went to
  the real defects, not a new style.
- **No UI library added.** Plain CSS classes and a few Angular components cover every pattern; a component library
  would add weight and a second visual language.
- **Fixed:** the Reports "By month" chart was squashed (two charts shared the `.bars` class; the list one is now `.hbars`);
  table drop-downs could shrink to nothing (Customers); table row buttons ran off the edge; small buttons broke
  their label onto two lines; four rules were defined twice with conflicting values; an `!important` patch for card
  spacing; the dark public header hid the globe icon; three pages each had their own copy of the public header.
