import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { TPipe } from '../core/i18n';
import { Plan } from '../core/models';
import { Icon } from '../shared/icon';
import { LangSwitch } from '../shared/lang-switch';

/** The public front page: what MyTerra offers, live plans and network status, and the way in (apply / sign in). */
@Component({
  selector: 'app-home',
  imports: [TPipe, RouterLink, CurrencyPipe, Icon, LangSwitch],
  template: `
    <div class="home">
      <header class="home-head">
        <a class="wordmark" routerLink="/">myterra</a>
        <nav class="home-nav" [attr.aria-label]="'Main' | t">
          <a href="#plans">{{ 'Plans' | t }}</a>
          <a href="#how">{{ 'How it works' | t }}</a>
          <a href="#questions">{{ 'Questions' | t }}</a>
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

      <main id="main" tabindex="-1">
        <section class="hero">
          <div class="hero-text">
            <a class="status-pill" [class.warn]="outages() > 0" routerLink="/status">
              <span class="dot" aria-hidden="true"></span>
              {{ (outages() === 0 ? 'All services are running normally.' : outages() === 1 ? 'One area has a known issue.' : '{n} areas have a known issue.') | t: { n: outages() } }}
            </a>
            <h1>{{ 'Fast home internet you can run from your phone.' | t }}</h1>
            <p class="hero-sub">{{ 'Fiber plans across Lebanon. Apply online in about 3 minutes, pick your installation day, then handle bills, data and support yourself.' | t }}</p>
            <div class="hero-actions">
              <a class="btn btn-amber" routerLink="/apply">{{ 'Apply now' | t }}</a>
              <a class="btn btn-ghost-light" routerLink="/login">{{ 'Sign in' | t }}</a>
            </div>
          </div>
          <div class="fiber-line" aria-hidden="true"><span></span></div>
        </section>

        <section class="home-section" id="plans" aria-labelledby="plans-title">
          <h2 id="plans-title">{{ 'Plans' | t }}</h2>
          <p class="muted">{{ 'Every plan includes a free router and installation. Switch plans any time from your account.' | t }}</p>
          <div class="home-plans">
            @for (p of plans(); track p.id) {
              <article class="home-plan" [class.best]="p.id === bestValue()">
                @if (p.id === bestValue()) { <span class="plan-badge">{{ 'Best value per GB' | t }}</span> }
                <h3>{{ p.name }}</h3>
                <p class="home-plan-price">{{ p.price | currency: 'USD' : 'symbol' : '1.0-2' }}<small>{{ '/month' | t }}</small></p>
                <ul>
                  <li><strong>{{ '{n} Mbps' | t: { n: p.speed_mbps } }}</strong> {{ 'download speed' | t }}</li>
                  <li><strong>{{ '{n} GB' | t: { n: p.data_gb } }}</strong> {{ 'data a month' | t }}</li>
                  <li>{{ 'Free router and installation' | t }}</li>
                </ul>
                <a class="btn" [class.btn-ghost]="p.id !== bestValue()" routerLink="/apply" [queryParams]="{ plan: p.id }">{{ 'Choose this plan' | t }}</a>
              </article>
            } @empty {
              <p class="muted">{{ (plansLoaded() ? 'No plans are available right now, so applications are closed. Please try again later.' : 'Loading…') | t }}</p>
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
        <span class="muted">© {{ year }} MyTerra</span>
      </footer>
    </div>
  `,
})
export class Home implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  plans = signal<Plan[]>([]);
  plansLoaded = signal(false);
  outages = signal(0);
  readonly year = new Date().getFullYear();
  /** Worked out from the real plans: the lowest price per GB. */
  bestValue = computed(() => {
    const ps = this.plans().filter(p => p.data_gb > 0);
    return ps.length > 1 ? ps.reduce((a, b) => (b.price / b.data_gb < a.price / a.data_gb ? b : a)).id : null;
  });

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
    this.api.plans().subscribe({ next: p => { this.plans.set(p); this.plansLoaded.set(true); }, error: () => this.plansLoaded.set(true) });
    this.api.status().subscribe({ next: s => this.outages.set(s.active.length), error: () => {} });
  }
}
