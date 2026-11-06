import { CurrencyPipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { RTL, TPipe } from '../core/i18n';
import { Plan } from '../core/models';
import { Icon } from '../shared/icon';
import { FibreArt } from '../shared/fibre-art';
import { LangSwitch } from '../shared/lang-switch';
import { LoadError, Skeleton } from '../shared/loading';
import { CountUp } from '../shared/count-up';
import { errorText } from '../core/errors';

export type Activity = 'stream4k' | 'gaming' | 'calls' | 'downloads';
export const PEOPLE = [{ id: 'small', label: '1–2', count: 1.5 }, { id: 'medium', label: '3–4', count: 3.5 }, { id: 'large', label: '5+', count: 6 }];

/** Rough monthly data and speed a household needs. Generous on purpose: running out is worse than spare. */
export function householdNeed(people: number, activities: Activity[]): { gb: number; mbps: number } {
  const has = (a: Activity) => activities.includes(a);
  return {
    gb: Math.round(12 * people + (has('stream4k') ? 60 : 0) + (has('gaming') ? 20 : 0) + (has('calls') ? 25 : 0) + (has('downloads') ? 60 : 0)),
    mbps: Math.round(15 * people + (has('stream4k') ? 40 : 0) + (has('gaming') ? 15 : 0) + (has('calls') ? 15 : 0) + (has('downloads') ? 60 : 0)),
  };
}

/** The cheapest plan that covers the need; if none does, the plan with the most data (topped up with extra packs). */
export function recommend(plans: Plan[], need: { gb: number; mbps: number }): { plan: Plan; fits: boolean } | null {
  if (!plans.length) return null;
  const fitting = plans.filter(p => p.data_gb >= need.gb && p.speed_mbps >= need.mbps).sort((a, b) => a.price - b.price);
  if (fitting.length) return { plan: fitting[0], fits: true };
  return { plan: [...plans].sort((a, b) => b.data_gb - a.data_gb || b.speed_mbps - a.speed_mbps)[0], fits: false };
}

const SLIDES = [
  { img: 'home/stream.webp', title: 'Movie night without buffering', text: 'Stream in 4K on the TV while everyone else is online too.', alt: 'A father and son on the sofa with popcorn, watching TV' },
  { img: 'home/call.webp', title: 'Close to family abroad', text: 'Clear video calls with the people you love, wherever they live.', alt: 'An older couple waving to their family on a video call' },
  { img: 'home/work.webp', title: 'Work from home with confidence', text: 'Steady upload speed for calls, cloud files and online classes.', alt: 'A woman working on a laptop at a desk at home' },
  { img: 'home/game.webp', title: 'Low ping for gamers', text: 'Fiber keeps response times low, and you can test your ping any time.', alt: 'A gamer with a headset playing at a computer' },
  { img: 'home/router.webp', title: 'Free router and installation', text: 'A technician sets everything up on the day you choose.', alt: 'A white Wi-Fi router with a network cable plugged in' },
];

/** The public front page: what MyTerra offers, real plans and network status, and the way in (apply / sign in). */
@Component({
  selector: 'app-home',
  imports: [TPipe, RouterLink, CurrencyPipe, Icon, LangSwitch, LoadError, Skeleton, FibreArt, CountUp],
  template: `
    <div class="home">
      <header class="home-head">
        <a class="wordmark" routerLink="/">myterra</a>
        <nav class="home-nav" [attr.aria-label]="'Main' | t">
          <a href="#finder">{{ 'Find your plan' | t }}</a>
          <a href="#plans">{{ 'Plans' | t }}</a>
          <a href="#how">{{ 'How it works' | t }}</a>
          <a routerLink="/status">{{ 'Network status' | t }}</a>
        </nav>
        <span class="head-right">
          <app-lang-switch />
          @if (auth.isLoggedIn()) {
            <a class="btn btn-amber btn-sm" [routerLink]="auth.isStaff() ? '/admin' : '/dashboard'">{{ 'My account' | t }}</a>
          } @else {
            <a class="home-signin" routerLink="/login">{{ 'Sign in' | t }}</a>
            <a class="btn btn-amber btn-sm" routerLink="/apply">{{ 'Apply now' | t }}</a>
          }
        </span>
      </header>
      <ul class="promise-strip">
        <li><app-icon name="check" [size]="18" />{{ 'Free router and installation' | t }}</li>
        <li><app-icon name="check" [size]="18" />{{ 'Apply online in about 3 minutes' | t }}</li>
        <li><app-icon name="check" [size]="18" /><a routerLink="/status">{{ 'Live network status' | t }}</a></li>
      </ul>

      <main id="main" tabindex="-1">
        <section class="hero">
          <app-fibre-art />
          <div class="hero-grid">
            <div class="hero-text">
              <a class="status-pill" [class.warn]="outages() > 0" routerLink="/status">
                <span class="dot" aria-hidden="true"></span>
                {{ (outages() === 0 ? 'All services are running normally.' : outages() === 1 ? 'One area has a known issue.' : '{n} areas have a known issue.') | t: { n: outages() } }}
              </a>
              <h1>{{ 'Fast home internet you can run from your phone.' | t }}</h1>
              <p class="hero-sub">{{ 'Fiber plans across Lebanon. Apply online in about 3 minutes, pick your installation day, then handle bills, data and support yourself.' | t }}</p>
              <div class="hero-actions">
                <a class="btn btn-amber shine" routerLink="/apply">{{ 'Apply now' | t }}</a>
                <a class="btn btn-ghost-light" routerLink="/login">{{ 'Sign in' | t }}</a>
              </div>
            </div>
            <figure class="hero-photo">
              <span class="signal" aria-hidden="true"><i></i><i></i><i></i></span>
              <img src="home/hero.webp" width="1000" height="1100" fetchpriority="high" (error)="hideBroken($event)" [alt]="'A family at home on the sofa, each on a phone or tablet' | t" />
              @if (topSpeed()) {
                <figcaption class="hero-chip"><strong countUp>{{ '{n} Mbps' | t: { n: topSpeed() } }}</strong><span>{{ 'top download speed' | t }}</span></figcaption>
              }
            </figure>
          </div>
          <div class="fiber-line" aria-hidden="true"><span></span></div>
        </section>

        <section class="home-section" aria-labelledby="life-title" (mouseenter)="hold.set(true)" (mouseleave)="hold.set(false)"
                 (focusin)="hold.set(true)" (focusout)="hold.set(false)">
          <div class="section-head">
            <div><h2 id="life-title">{{ 'Made for how you live' | t }}</h2>
              <p class="muted">{{ 'Swipe or drag to see more.' | t }}</p></div>
            <div class="carousel-arrows">
              <button type="button" class="icon-btn round" (click)="paused.set(!paused())" [attr.aria-pressed]="paused()"
                      [attr.aria-label]="(paused() ? 'Play slideshow' : 'Pause slideshow') | t">
                <app-icon [name]="paused() ? 'play' : 'pause'" /></button>
              <button type="button" class="icon-btn round" (click)="move(-1)" [disabled]="slide() === 0" [attr.aria-label]="'Previous' | t">
                <app-icon name="arrow" [class.flip]="!rtl" /></button>
              <button type="button" class="icon-btn round" (click)="move(1)" [disabled]="slide() === slides.length - 1" [attr.aria-label]="'Next' | t">
                <app-icon name="arrow" [class.flip]="rtl" /></button>
            </div>
          </div>
          <div #track class="carousel" tabindex="0" role="region" aria-roledescription="carousel" [attr.aria-label]="'Made for how you live' | t"
               [class.dragging]="dragging()" (scroll)="onScroll()" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"
               (pointerup)="dragEnd()" (pointercancel)="dragEnd()" (click)="swallowClickAfterDrag($event)">
            @for (s of slides; track s.img; let i = $index) {
              <article class="slide" role="group" aria-roledescription="slide" [attr.aria-label]="'{n} of {total}' | t: { n: i + 1, total: slides.length }">
                <img [src]="s.img" width="1200" height="800" loading="lazy" decoding="async" draggable="false" (error)="hideBroken($event)" [alt]="s.alt | t" />
                <div class="slide-text"><h3>{{ s.title | t }}</h3><p>{{ s.text | t }}</p></div>
              </article>
            }
          </div>
          <div class="dots" role="group" [attr.aria-label]="'Choose a photo' | t">
            @for (s of slides; track s.img; let i = $index) {
              <button type="button" class="dot-btn" [class.on]="i === slide()" (click)="goTo(i)" [attr.aria-label]="'{n} of {total}' | t: { n: i + 1, total: slides.length }"
                      [attr.aria-current]="i === slide() ? 'true' : null"></button>
            }
          </div>
        </section>

        <section class="home-section finder" id="finder" aria-labelledby="finder-title">
          <h2 id="finder-title">{{ 'Find your plan' | t }}</h2>
          <p class="muted">{{ 'Tell us about your home and we’ll suggest a plan. You can change it any time.' | t }}</p>
          <div class="finder-grid">
            <div class="finder-controls">
              <fieldset>
                <legend>{{ 'People at home' | t }}</legend>
                <div class="seg">
                  @for (p of people; track p.id) {
                    <label [class.on]="household() === p.id"><input type="radio" name="people" [value]="p.id" [checked]="household() === p.id" (change)="household.set(p.id)" />{{ p.label }}</label>
                  }
                </div>
              </fieldset>
              <fieldset>
                <legend>{{ 'What do you do online?' | t }}</legend>
                <div class="chips">
                  @for (a of activities; track a.id) {
                    <label [class.on]="has(a.id)"><input type="checkbox" [checked]="has(a.id)" (change)="toggle(a.id)" />{{ a.label | t }}</label>
                  }
                </div>
              </fieldset>
            </div>
            <div class="finder-result" aria-live="polite">
              @if (suggestion(); as r) {
                <p class="muted">{{ 'We recommend' | t }}</p>
                <p class="finder-plan">{{ r.plan.name }}</p>
                <p>{{ (r.fits ? 'About {gb} GB a month and {mbps} Mbps suit your home. This plan covers both for {price} a month.'
                      : 'Your home could use about {gb} GB and {mbps} Mbps. This is our biggest plan; add extra data packs in busy months.')
                      | t: { gb: need().gb, mbps: need().mbps, price: (r.plan.price | currency: 'USD' : 'symbol' : '1.0-2') } }}</p>
                <a class="btn btn-amber" routerLink="/apply" [queryParams]="{ plan: r.plan.id }">{{ 'Choose {plan}' | t: { plan: r.plan.name } }}</a>
              } @else if (plansError()) {
                <p>{{ plansError() }}</p>
              } @else {
                <app-skeleton />
              }
            </div>
          </div>
        </section>

        <section class="home-section" id="plans" aria-labelledby="plans-title">
          <h2 id="plans-title">{{ 'Plans' | t }}</h2>
          <p class="muted">{{ 'Every plan includes a free router and installation. Switch plans any time from your account.' | t }}</p>
          <div class="home-plans">
            @for (p of plans(); track p.id) {
              <article class="home-plan" [class.best]="p.id === suggestion()?.plan?.id">
                @if (p.id === suggestion()?.plan?.id) { <span class="plan-badge">{{ 'Recommended for you' | t }}</span> }
                <h3>{{ p.name }}</h3>
                <p class="home-plan-price">{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}<small>{{ '/month' | t }}</small></p>
                <ul>
                  <li><strong>{{ '{n} Mbps' | t: { n: p.speed_mbps } }}</strong> {{ 'download speed' | t }}</li>
                  <li><strong>{{ '{n} GB' | t: { n: p.data_gb } }}</strong> {{ 'data a month' | t }}</li>
                  <li>{{ 'Free router and installation' | t }}</li>
                  @if (p.id === bestValue()) { <li class="value-note">{{ 'Best value per GB' | t }}</li> }
                </ul>
                <a class="btn" [class.btn-ghost]="p.id !== suggestion()?.plan?.id" routerLink="/apply" [queryParams]="{ plan: p.id }">{{ 'Choose this plan' | t }}</a>
              </article>
            } @empty {
              @if (plansLoaded()) { <p class="muted">{{ 'No plans are available right now, so applications are closed. Please try again later.' | t }}</p>
              } @else if (plansError()) { <app-load-error [message]="plansError()" (retry)="loadPlans()" />
              } @else { <app-skeleton kind="rows" /> }
            }
          </div>
        </section>

        <section class="home-section" aria-labelledby="self-title">
          <h2 id="self-title">{{ 'Your account does the work' | t }}</h2>
          <p class="muted">{{ 'No queues and no phone calls: everything you need is in your account, on any device.' | t }}</p>
          <ul class="home-features">
            @for (f of features; track f.title) {
              <li><app-icon [name]="f.icon" [size]="24" />
                <div><h3>{{ f.title | t }}</h3><p>{{ f.text | t }}</p></div></li>
            }
          </ul>
        </section>

        <section class="home-section" id="how" aria-labelledby="how-title">
          <h2 id="how-title">{{ 'Online in three steps' | t }}</h2>
          <ol class="home-steps">
            @for (s of steps; track s.title) {
              <li><h3>{{ s.title | t }}</h3><p>{{ s.text | t }}</p></li>
            }
          </ol>
        </section>

        <section class="home-section" id="questions" aria-labelledby="faq-title">
          <h2 id="faq-title">{{ 'Questions' | t }}</h2>
          <div class="faq">
            @for (q of faq; track q.q) {
              <details><summary>{{ q.q | t }}</summary><p>{{ q.a | t }}</p></details>
            }
          </div>
        </section>

        <section class="home-cta">
          <h2>{{ 'Ready to get connected?' | t }}</h2>
          <p>{{ 'Apply now and choose the day the technician comes.' | t }}</p>
          <div class="hero-actions">
            <a class="btn btn-amber" routerLink="/apply">{{ 'Apply now' | t }}</a>
            <a class="btn btn-ghost-light" routerLink="/login">{{ 'I already have an account' | t }}</a>
          </div>
        </section>
      </main>

      <footer class="home-foot">
        <span class="wordmark">myterra</span>
        <nav [attr.aria-label]="'Footer' | t">
          <a routerLink="/status">{{ 'Network status' | t }}</a>
          <a routerLink="/apply">{{ 'Apply now' | t }}</a>
          <a routerLink="/login">{{ 'Sign in' | t }}</a>
          <a routerLink="/forgot">{{ 'Forgot password?' | t }}</a>
        </nav>
        <span class="muted">{{ 'Photos from Unsplash.' | t }} © {{ year }} MyTerra</span>
      </footer>
    </div>
  `,
})
export class Home implements OnInit, OnDestroy {
  private api = inject(ApiService);
  auth = inject(AuthService);
  readonly rtl = RTL;
  readonly slides = SLIDES;
  readonly people = PEOPLE;
  readonly activities: { id: Activity; label: string }[] = [
    { id: 'stream4k', label: '4K streaming' }, { id: 'calls', label: 'Video calls and work' },
    { id: 'gaming', label: 'Online gaming' }, { id: 'downloads', label: 'Big downloads' },
  ];
  plans = signal<Plan[]>([]);
  plansLoaded = signal(false);
  plansError = signal('');
  outages = signal(0);
  readonly year = new Date().getFullYear();

  // plan finder
  household = signal('medium');
  chosen = signal<Activity[]>(['calls']); // a typical home to start from; visitors adjust it
  need = computed(() => householdNeed(PEOPLE.find(p => p.id === this.household())!.count, this.chosen()));
  suggestion = computed(() => recommend(this.plans(), this.need()));
  has = (a: Activity) => this.chosen().includes(a);
  toggle(a: Activity) { this.chosen.update(list => list.includes(a) ? list.filter(x => x !== a) : [...list, a]); }

  topSpeed = computed(() => Math.max(0, ...this.plans().map(p => p.speed_mbps)));
  /** Worked out from the real plans: the lowest price per GB. */
  bestValue = computed(() => {
    const ps = this.plans().filter(p => p.data_gb > 0);
    return ps.length > 1 ? ps.reduce((a, b) => (b.price / b.data_gb < a.price / a.data_gb ? b : a)).id : null;
  });

  // Slideshow: moves on every 5 s, looping. Stops while the visitor hovers, focuses, drags or has another tab open,
  // and never starts for people who ask for reduced motion. The pause button satisfies WCAG 2.2.2.
  static readonly AUTOPLAY_MS = 5000;
  paused = signal(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  hold = signal(false);
  private lastMove = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  autoAdvance(now = Date.now()) {
    if (this.paused() || this.hold() || this.dragging() || document.hidden) { this.lastMove = now; return; }
    if (now - this.lastMove >= Home.AUTOPLAY_MS) this.goTo((this.slide() + 1) % this.slides.length);
  }

  // carousel: native scroll-snap (touch swipe for free) + mouse dragging, arrows, dots
  private track = viewChild.required<ElementRef<HTMLElement>>('track');
  slide = signal(0);
  dragging = signal(false);
  private drag: { x: number; left: number; moved: number } | null = null;

  private slideWidth() {
    const el = this.track().nativeElement;
    const first = el.querySelector<HTMLElement>('.slide');
    return first ? first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || '0') : el.clientWidth;
  }
  onScroll() {
    // scrollLeft is negative in right-to-left layouts
    this.slide.set(Math.min(this.slides.length - 1, Math.round(Math.abs(this.track().nativeElement.scrollLeft) / this.slideWidth())));
  }
  goTo(i: number) {
    this.lastMove = Date.now(); // any move (auto, arrows, dots) restarts the 5-second wait
    const el = this.track().nativeElement;
    el.scrollTo({ left: (this.rtl ? -1 : 1) * i * this.slideWidth(), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  move(step: number) { this.goTo(Math.max(0, Math.min(this.slides.length - 1, this.slide() + step))); }

  dragStart(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return; // touch and pens already swipe natively
    this.drag = { x: e.clientX, left: this.track().nativeElement.scrollLeft, moved: 0 };
    this.track().nativeElement.setPointerCapture?.(e.pointerId); // keep following the mouse outside the photos
  }
  dragMove(e: PointerEvent) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    this.drag.moved = Math.max(this.drag.moved, Math.abs(dx));
    if (this.drag.moved > 4) this.dragging.set(true); // snapping off while the mouse holds the track
    this.track().nativeElement.scrollLeft = this.drag.left - dx;
  }
  dragEnd() {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.dragging.set(false);
    if (moved > 4) { this.onScroll(); this.goTo(this.slide()); } // settle on the nearest photo
    this.lastDrag = moved;
  }
  private lastDrag = 0;
  swallowClickAfterDrag(e: Event) { if (this.lastDrag > 4) { e.preventDefault(); e.stopPropagation(); this.lastDrag = 0; } }

  readonly features = [
    { icon: 'gauge', title: 'See your data', text: 'Daily use, what is left this month, and extra data when you run out.' },
    { icon: 'bill', title: 'Pay in seconds', text: 'Pay by card or from your balance, or turn on autopay. Printable invoices.' },
    { icon: 'wifi', title: 'Test your real speed', text: 'A real speed test of your Wi-Fi and line, compared with what your plan promises.' },
    { icon: 'help', title: 'Get help fast', text: 'Quick fixes first, then a ticket you can follow, with your speed test attached.' },
    { icon: 'alert', title: 'Know about outages', text: 'Live network status, and an alert when your area is affected.' },
    { icon: 'settings', title: 'Stay in control', text: 'Move your installation visit, choose your emails, and sign out lost devices.' },
  ];
  readonly steps = [
    { title: 'Apply online', text: 'Choose a plan, verify your email and pay the first month by card.' },
    { title: 'We install', text: 'A technician sets up fiber and a free router on the day you picked.' },
    { title: 'You are online', text: 'Sign in to see your data, bills and support in one place.' },
  ];
  readonly faq = [
    { q: 'Which areas do you cover?', a: 'We install across Lebanon, including Beirut, Tripoli, Saida, Jounieh, Zahle, Byblos and Tyre. Apply with your address and we will confirm.' },
    { q: 'How soon can you install?', a: 'You choose the day, from tomorrow up to 60 days ahead. The visit is between 9:00 and 17:00, and you can move it from your account.' },
    { q: 'Can I change plan later?', a: 'Yes, any time from your account. The new price starts with your next bill.' },
    { q: 'How do I pay?', a: 'By card online, from your account balance, or automatically with autopay.' },
    { q: 'What if I run out of data?', a: 'Buy 10, 25 or 50 GB extra for the rest of the month, without changing plan.' },
  ];

  ngOnInit() {
    this.timer = setInterval(() => this.autoAdvance(), 500);
    this.loadPlans();
    this.api.status().subscribe({ next: s => this.outages.set(s.active.length), error: () => {} });
  }

  /** A photo that fails to load leaves its tinted frame and caption rather than a broken-image icon. */
  hideBroken(e: Event) { (e.target as HTMLImageElement).style.visibility = 'hidden'; }

  loadPlans() {
    this.plansError.set('');
    this.api.plans().subscribe({ next: p => { this.plans.set(p); this.plansLoaded.set(true); }, error: e => this.plansError.set(errorText(e)) });
  }

  ngOnDestroy() { clearInterval(this.timer); }
}
