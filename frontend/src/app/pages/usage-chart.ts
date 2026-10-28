import { Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { UsageDay } from '../core/models';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
Chart.defaults.font.family = "'Source Sans 3', system-ui, sans-serif";

@Component({
  selector: 'app-usage-chart',
  template: `<div class="chart"><canvas #canvas role="img" [attr.aria-label]="label()"></canvas></div>`,
})
export class UsageChart implements OnDestroy {
  days = input.required<UsageDay[]>();
  canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  label() {
    return `Daily data use this month, ${this.days().length} days`;
  }

  constructor() {
    effect(() => {
      const days = this.days();
      const ctx = this.canvas().nativeElement.getContext?.('2d');
      if (!ctx) return; // no canvas in the test environment
      this.chart?.destroy();
      const css = getComputedStyle(document.documentElement);
      const color = (v: string) => css.getPropertyValue(v).trim();
      this.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: days.map(d => d.day),
          datasets: [{
            data: days.map(d => d.gb),
            backgroundColor: days.map((_, i) => i === days.length - 1 ? color('--amber') : color('--pine')),
            borderRadius: 3,
            maxBarThickness: 18,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { title: i => `Day ${i[0].label}`, label: i => `${i.parsed.y} GB` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: color('--muted') } },
            y: { beginAtZero: true, grid: { color: color('--line') }, ticks: { color: color('--muted'), callback: v => `${v} GB` } },
          },
        },
      });
    });
  }

  ngOnDestroy() { this.chart?.destroy(); }
}
