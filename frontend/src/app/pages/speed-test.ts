import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { API, ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { errorText } from '../core/errors';
import { SpeedResult } from '../core/models';

/** Megabits per second for `bytes` moved in `ms` milliseconds. */
export function mbps(bytes: number, ms: number): number {
  return ms > 0 ? (bytes * 8) / (ms / 1000) / 1_000_000 : 0;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const DOWNLOAD_MB = 8;
const UPLOAD_BYTES = 4 * 1024 * 1024;
type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done';

@Component({
  selector: 'app-speed-test',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <h1>Speed test</h1>
    <p class="muted lead">Measures the connection between this device and the MyTerra network. For the most accurate result, use a cable or stand near your router.</p>

    <section class="card speed">
      <div class="gauge" [class.running]="running()">
        <svg viewBox="0 0 200 120" aria-hidden="true">
          <path class="gauge-track" d="M20 110 A80 80 0 0 1 180 110" />
          <path class="gauge-fill" d="M20 110 A80 80 0 0 1 180 110" [attr.stroke-dasharray]="arc() + ' 252'" />
        </svg>
        <p class="gauge-value" aria-live="polite">
          <strong>{{ live() | number: '1.0-1' }}</strong> Mbps<br />
          <span class="muted">{{ phaseLabel() }}</span>
        </p>
      </div>

      <dl class="speed-results">
        <div><dt>Ping</dt><dd>{{ ping() !== null ? (ping() | number: '1.0-0') + ' ms' : '–' }}</dd></div>
        <div><dt>Download</dt><dd>{{ down() !== null ? (down() | number: '1.0-1') + ' Mbps' : '–' }}</dd></div>
        <div><dt>Upload</dt><dd>{{ up() !== null ? (up() | number: '1.0-1') + ' Mbps' : '–' }}</dd></div>
      </dl>

      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (phase() === 'done' && verdict(); as v) { <p class="verdict" [class.bad]="v.bad">{{ v.text }}</p> }

      <div class="row-actions center">
        <button class="btn" type="button" (click)="run()" [disabled]="running()">
          {{ running() ? 'Testing…' : phase() === 'done' ? 'Test again' : 'Start test' }}
        </button>
        @if (phase() === 'done' && verdict()?.bad && saved()) {
          <a class="btn btn-ghost" [routerLink]="['/support']" [queryParams]="{ speed: saved()!.id }">Report slow speed</a>
        }
      </div>
    </section>

    <section class="card">
      <h2>Past results</h2>
      @if (planSpeed()) { <p class="muted">Your plan: up to {{ planSpeed() }} Mbps.</p> }
      <div class="table-wrap flat">
        <table>
          <thead><tr><th>When</th><th>Download</th><th>Upload</th><th>Ping</th></tr></thead>
          <tbody>
            @for (r of history(); track r.id) {
              <tr><td>{{ r.created_at | date: 'd MMM, HH:mm' }}</td><td>{{ r.download_mbps | number: '1.0-1' }} Mbps</td>
                <td>{{ r.upload_mbps | number: '1.0-1' }} Mbps</td><td>{{ r.ping_ms | number: '1.0-0' }} ms</td></tr>
            } @empty { <tr><td colspan="4" class="muted">No tests yet. Run one above.</td></tr> }
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
  planSpeed = signal<number | null>(null);
  saved = signal<SpeedResult | null>(null);

  running = computed(() => ['ping', 'download', 'upload'].includes(this.phase()));
  // Gauge scale grows with the plan so a 1 Gbps line doesn't sit pinned at the end.
  arc = computed(() => Math.min(1, this.live() / Math.max(100, (this.planSpeed() ?? 100) * 1.2)) * 252);
  phaseLabel = computed(() => ({ idle: 'Ready', ping: 'Checking response time…', download: 'Download', upload: 'Upload',
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
    this.api.speedTests().subscribe({
      next: r => { this.history.set(r.results); this.planSpeed.set(r.plan_speed_mbps); },
      error: () => {},
    });
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.auth.token()}` };
  }

  async run() {
    this.error.set('');
    this.saved.set(null);
    this.ping.set(null); this.down.set(null); this.up.set(null); this.live.set(0);
    try {
      this.phase.set('ping');
      const pings: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await fetch(`${API}/speedtest/ping`, { headers: this.headers(), cache: 'no-store' });
        pings.push(performance.now() - t);
      }
      this.ping.set(median(pings));

      this.phase.set('download');
      const start = performance.now();
      const res = await fetch(`${API}/speedtest/download?mb=${DOWNLOAD_MB}`, { headers: this.headers(), cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error('download failed');
      const reader = res.body.getReader();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        this.live.set(mbps(received, performance.now() - start));
      }
      this.down.set(mbps(received, performance.now() - start));

      this.phase.set('upload');
      const body = new Uint8Array(UPLOAD_BYTES);
      const t0 = performance.now();
      const up = await fetch(`${API}/speedtest/upload`, { method: 'POST', headers: this.headers(), body });
      if (!up.ok) throw new Error('upload failed');
      this.up.set(mbps(UPLOAD_BYTES, performance.now() - t0));
      this.live.set(this.down()!);
      this.phase.set('done');

      this.api.saveSpeedTest({
        ping_ms: Math.round(this.ping()! * 10) / 10,
        download_mbps: Math.round(this.down()! * 10) / 10,
        upload_mbps: Math.round(this.up()! * 10) / 10,
      }).subscribe({
        next: r => { this.saved.set(r); this.loadHistory(); },
        error: e => this.error.set(errorText(e, 'The test finished but we couldn’t save it.')),
      });
    } catch {
      this.phase.set('idle');
      this.live.set(0);
      this.error.set('The test stopped. Check your connection and try again.');
    }
  }
}
