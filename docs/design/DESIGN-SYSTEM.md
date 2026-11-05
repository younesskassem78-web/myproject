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
