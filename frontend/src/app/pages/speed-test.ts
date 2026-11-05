import { DatePipe, DecimalPipe } from '@angular/common';
import { TPipe, t } from '../core/i18n';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { API, ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';
import { SpeedResult } from '../core/models';
import { LoadError, Skeleton } from '../shared/loading';

/** Megabits per second for `bytes` moved in `ms` milliseconds. */
export function mbps(bytes: number, ms: number): number {
  return ms > 0 ? (bytes * 8) / (ms / 1000) / 1_000_000 : 0;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Real speed tests run against Cloudflare's public speed-test servers (the ones behind speed.cloudflare.com),
 * so the result reflects this device's Wi-Fi or cable plus the internet line. If Cloudflare can't be reached,
 * the test falls back to the MyTerra server (which only becomes meaningful once MyTerra is hosted online).
 */
export const CLOUDFLARE = 'https://speed.cloudflare.com';
const WARMUP_MS = 1000; // connections start slow (TCP slow start); measure after this
const DOWNLOAD_MS = 7000;
const UPLOAD_MS = 7000;
type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done';

interface Target {
  name: string;
  /** `tag` makes each request's URL unique so its browser timing entry can be found. */
  ping: (tag: string) => Promise<Response>;
  download: (signal: AbortSignal) => Promise<Response>;
  upload: (bytes: number, signal: AbortSignal) => Promise<Response>;
  maxUpload: number;
  streams: number;
}

/**
 * Moves data with `workers` parallel loops until `durationMs` is up and returns Mbps, counting only what
 * moved after the warm-up. `job` adds bytes through `add` and runs until the signal aborts.
 */
export async function measure(durationMs: number, workers: number, job: (add: (n: number) => void, signal: AbortSignal) => Promise<void>,
                              onLive: (mbps: number) => void = () => {}): Promise<number> {
  const stop = new AbortController();
  const start = performance.now();
  let total = 0, atWarmup = -1, warmedAt = 0;
  const add = (n: number) => {
    total += n;
    const now = performance.now();
    if (atWarmup < 0 && now - start >= WARMUP_MS) { atWarmup = total; warmedAt = now; }
    if (atWarmup >= 0) onLive(mbps(total - atWarmup, now - warmedAt));
  };
  const timer = setTimeout(() => stop.abort(), durationMs);
  await Promise.all(Array.from({ length: workers }, () => job(add, stop.signal).catch(e => {
    if (!stop.signal.aborted) throw e; // aborting at the deadline is how the test ends
  })));
  clearTimeout(timer);
  const end = performance.now();
  // Very slow lines may not reach the warm-up mark: then use the whole run.
  return atWarmup >= 0 ? mbps(total - atWarmup, end - warmedAt) : mbps(total, end - start);
}

/** Network round trip from a timing entry: request sent → first byte, minus the server's own processing time. */
export function networkTime(e: Pick<PerformanceResourceTiming, 'requestStart' | 'responseStart' | 'serverTiming'>): number {
  const server = (e.serverTiming ?? []).reduce((sum, t) => sum + (t.duration || 0), 0);
  return Math.max(0, e.responseStart - e.requestStart - server);
}

async function downloadJob(target: Target, add: (n: number) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    const res = await target.download(signal);
    if (!res.ok || !res.body) throw new Error('download failed');
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      add(value.length);
    }
  }
}

async function uploadJob(target: Target, add: (n: number) => void, signal: AbortSignal) {
  let size = 256 * 1024; // grows while each upload finishes quickly, so fast lines aren't measured with tiny pieces
  while (!signal.aborted) {
    const t = performance.now();
    const res = await target.upload(size, signal);
    if (!res.ok) throw new Error('upload failed');
    add(size);
    if (performance.now() - t < 800 && size < target.maxUpload) size = Math.min(size * 2, target.maxUpload);
  }
}

@Component({
  selector: 'app-speed-test',
  imports: [TPipe, DatePipe, DecimalPipe, RouterLink, LoadError, Skeleton],
  template: `
    <h1>{{ 'Speed test' | t }}</h1>
    <p class="muted lead">{{ 'Measures your real connection (this device’s Wi-Fi or cable, plus your internet line) against the nearest
      Cloudflare speed-test server. It takes about 20 seconds and can use 50 to 300 MB on fast lines.
      For the most accurate result, close other downloads and stand near your router.' | t }}</p>

    <section class="card speed">
      <div class="gauge" [class.running]="running()">
        <svg viewBox="0 0 200 120" aria-hidden="true">
          <path class="gauge-track" d="M20 110 A80 80 0 0 1 180 110" />
          <path class="gauge-fill" d="M20 110 A80 80 0 0 1 180 110" [attr.stroke-dasharray]="arc() + ' 252'" />
        </svg>
        <p class="gauge-value" aria-live="polite">
          <strong>{{ live() | number: '1.0-1' }}</strong> {{ 'Mbps' | t }}<br />
          <span class="muted">{{ phaseLabel() }}</span>
        </p>
      </div>

      <dl class="speed-results">
        <div><dt>{{ 'Ping' | t }}</dt><dd>{{ ping() !== null ? (ping() | number: '1.0-0') + ' ms' : '–' }}</dd></div>
        <div><dt>{{ 'Download' | t }}</dt><dd>{{ down() !== null ? (down() | number: '1.0-1') + ' Mbps' : '–' }}</dd></div>
        <div><dt>{{ 'Upload' | t }}</dt><dd>{{ up() !== null ? (up() | number: '1.0-1') + ' Mbps' : '–' }}</dd></div>
      </dl>
      @if (server()) { <p class="muted center-text">{{ 'Server: {name}' | t: { name: (server() | t) } }}</p> }

      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (phase() === 'done' && verdict(); as v) { <p class="verdict" [class.bad]="v.bad">{{ v.text }}</p> }

      <div class="row-actions center">
        <button class="btn" type="button" (click)="run()" [disabled]="running()">
          {{ (running() ? 'Testing…' : phase() === 'done' ? 'Test again' : 'Start test') | t }}
        </button>
        @if (phase() === 'done' && verdict()?.bad && saved()) {
          <a class="btn btn-ghost" [routerLink]="['/support']" [queryParams]="{ speed: saved()!.id }">{{ 'Report slow speed' | t }}</a>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'Past results' | t }}</h2>
      @if (planSpeed()) { <p class="muted">{{ 'Your plan: up to {n} Mbps.' | t: { n: planSpeed() } }}</p> }
      <div class="table-wrap flat" tabindex="0" role="region" [attr.aria-label]="'Scrollable table' | t">
        <table>
          <thead><tr><th>{{ 'When' | t }}</th><th>{{ 'Download' | t }}</th><th>{{ 'Upload' | t }}</th><th>{{ 'Ping' | t }}</th></tr></thead>
          <tbody>
            @for (r of history(); track r.id) {
              <tr><td>{{ r.created_at | date: 'd MMM, HH:mm' }}@if (r.server) {<br /><span class="muted">{{ r.server | t }}</span>}</td><td>{{ r.download_mbps | number: '1.0-1' }} Mbps</td>
                <td>{{ r.upload_mbps | number: '1.0-1' }} Mbps</td><td>{{ r.ping_ms | number: '1.0-0' }} ms</td></tr>
            } @empty { <tr><td colspan="4" class="muted">@if (loaded()) { {{ 'No tests yet. Run one above.' | t }}
              } @else if (historyError()) { <app-load-error [message]="historyError()" (retry)="loadHistory()" />
              } @else { <app-skeleton kind="rows" /> }</td></tr> }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class SpeedTest implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  phase = signal<Phase>('idle');
  live = signal(0);
  ping = signal<number | null>(null);
  down = signal<number | null>(null);
  up = signal<number | null>(null);
  error = signal('');
  history = signal<SpeedResult[]>([]);
  historyError = signal('');
  loaded = signal(false); // lists say "Loading…", not "nothing here", until the data arrives
  planSpeed = signal<number | null>(null);
  saved = signal<SpeedResult | null>(null);
  server = signal(''); // which server answered, e.g. "Cloudflare, Beirut"

  running = computed(() => ['ping', 'download', 'upload'].includes(this.phase()));
  // Gauge scale grows with the plan so a 1 Gbps line doesn't sit pinned at the end.
  arc = computed(() => Math.min(1, this.live() / Math.max(100, (this.planSpeed() ?? 100) * 1.2)) * 252);
  phaseLabel = computed(() => t({ idle: 'Ready', ping: 'Checking response time…', download: 'Download', upload: 'Upload',
    done: 'Download' }[this.phase()]));
  verdict = computed(() => {
    const d = this.down(), plan = this.planSpeed();
    if (d === null || !plan) return null;
    const pct = Math.round((d / plan) * 100);
    if (pct >= 80) return { bad: false, text: `Great: you're getting the speed your plan promises (${plan} Mbps).` };
    return { bad: true, text: `Slower than expected: about ${pct}% of your plan's ${plan} Mbps. Restart your router and test again. If it stays slow, report it and we'll attach this result.` };
  });

  ngOnInit() { this.loadHistory(); }

  loadHistory() {
    this.historyError.set('');
    this.api.speedTests().subscribe({
      next: r => { this.history.set(r.results); this.planSpeed.set(r.plan_speed_mbps); this.loaded.set(true); },
      error: e => this.historyError.set(errorText(e)),
    });
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.auth.token()}` };
  }

  private cloudflare: Target = {
    name: 'Cloudflare',
    ping: tag => fetch(`${CLOUDFLARE}/__down?bytes=0&r=${tag}`, { cache: 'no-store' }),
    download: signal => fetch(`${CLOUDFLARE}/__down?bytes=25000000`, { cache: 'no-store', signal }),
    upload: (bytes, signal) => fetch(`${CLOUDFLARE}/__up`, { method: 'POST', body: new Uint8Array(bytes), signal }),
    maxUpload: 8 * 1024 * 1024,
    streams: 4,
  };
  private myterra: Target = {
    name: 'MyTerra',
    ping: tag => fetch(`${API}/speedtest/ping?r=${tag}`, { headers: this.headers(), cache: 'no-store' }),
    download: signal => fetch(`${API}/speedtest/download?mb=25`, { headers: this.headers(), cache: 'no-store', signal }),
    upload: (bytes, signal) => fetch(`${API}/speedtest/upload`, { method: 'POST', headers: this.headers(), body: new Uint8Array(bytes), signal }),
    maxUpload: 8 * 1024 * 1024,
    streams: 2,
  };

  /**
   * Median round trip of 8 tiny requests after one warm-up (which opens the connection). Like Cloudflare's own
   * test, it uses the browser's network timing (request sent → first byte back) minus the time the server
   * reports spending on the reply, so browser queueing and server work don't count as network delay.
   */
  private async measurePing(target: Target): Promise<number> {
    const first = await target.ping(`w${Date.now()}`);
    if (!first.ok) throw new Error('ping failed');
    await first.arrayBuffer();
    const times: number[] = [];
    for (let i = 0; i < 8; i++) {
      const tag = `${Date.now()}-${i}`;
      const t = performance.now();
      const res = await target.ping(tag);
      await res.arrayBuffer();
      const total = performance.now() - t;
      const entry = performance.getEntriesByType('resource').find(e => e.name.includes(`r=${tag}`)) as PerformanceResourceTiming | undefined;
      times.push(entry && entry.responseStart > 0 ? networkTime(entry) : total);
    }
    performance.clearResourceTimings();
    return median(times);
  }

  async run() {
    this.error.set('');
    this.saved.set(null);
    this.ping.set(null); this.down.set(null); this.up.set(null); this.live.set(0);
    this.server.set('');
    try {
      this.phase.set('ping');
      let target = this.cloudflare;
      let p: number;
      try {
        p = await this.measurePing(target);
      } catch {
        target = this.myterra; // Cloudflare unreachable (blocked network, offline internet): test to our own server
        p = await this.measurePing(target);
      }
      this.ping.set(p);
      this.server.set(target === this.cloudflare ? 'Cloudflare (nearest server)' : 'MyTerra server');

      this.phase.set('download');
      this.down.set(await measure(DOWNLOAD_MS, target.streams, (add, signal) => downloadJob(target, add, signal), v => this.live.set(v)));

      this.phase.set('upload');
      this.live.set(0);
      this.up.set(await measure(UPLOAD_MS, Math.min(3, target.streams), (add, signal) => uploadJob(target, add, signal), v => this.live.set(v)));
      this.live.set(this.down()!);
      this.phase.set('done');

      this.api.saveSpeedTest({
        ping_ms: Math.round(this.ping()! * 10) / 10,
        download_mbps: Math.round(this.down()! * 10) / 10,
        upload_mbps: Math.round(this.up()! * 10) / 10,
        server: this.server(),
      }).subscribe({
        next: r => { this.saved.set(r); this.loadHistory(); },
        error: e => this.error.set(errorText(e, t('The test finished but we couldn’t save it.'))),
      });
    } catch {
      this.phase.set('idle');
      this.live.set(0);
      this.error.set(t('The test stopped. Check your connection and try again.'));
    }
  }
}
