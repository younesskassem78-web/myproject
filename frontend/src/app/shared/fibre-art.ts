import { Component } from '@angular/core';

const N = 9;
/** Strands spread across the left edge and gather into one cable on the right, like fibre entering a building. */
const STRANDS = Array.from({ length: N }, (_, i) => {
  const start = 60 + (i * 620) / (N - 1);
  const end = 250 + (i - (N - 1) / 2) * 7;
  return `M -60 ${start} C 380 ${start}, 640 ${end + (i - 4) * 18}, 1260 ${end}`;
});
/** Light runs along a few strands, each at its own pace, so it never looks like a loop. */
const PULSES = [
  { d: STRANDS[1], dur: '7s', delay: '0s' },
  { d: STRANDS[4], dur: '5.5s', delay: '1.8s' },
  { d: STRANDS[6], dur: '8s', delay: '3.2s' },
  { d: STRANDS[8], dur: '6.5s', delay: '0.9s' },
];

/** Faint fibre strands with light travelling along them, behind the green hero and the sign-in panel. Pure SVG + CSS. */
@Component({
  selector: 'app-fibre-art',
  host: { class: 'fibre-art', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" focusable="false">
      @for (d of strands; track $index) { <path class="strand" [attr.d]="d" /> }
      @for (p of pulses; track $index) {
        <path class="pulse" [attr.d]="p.d" pathLength="1490" [style.--d]="p.dur" [style.--delay]="p.delay" />
      }
    </svg>
  `,
})
export class FibreArt {
  readonly strands = STRANDS;
  readonly pulses = PULSES;
}
