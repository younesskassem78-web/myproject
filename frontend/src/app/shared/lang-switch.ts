import { Component } from '@angular/core';
import { LANG, LANGS, Lang, TPipe, setLang } from '../core/i18n';
import { Icon } from './icon';

/** English / العربية / Français. Choosing one saves it and reloads the page in that language. */
@Component({
  selector: 'app-lang-switch',
  imports: [TPipe, Icon],
  template: `
    <label class="lang-switch">
      <app-icon name="globe" [size]="18" />
      <span class="visually-hidden">{{ 'Language' | t }}</span>
      <select (change)="set($any($event.target).value)" [attr.aria-label]="'Language' | t">
        @for (l of langs; track l.code) { <option [value]="l.code" [selected]="l.code === lang" [attr.lang]="l.code">{{ l.name }}</option> }
      </select>
    </label>
  `,
})
export class LangSwitch {
  readonly lang = LANG;
  readonly langs = LANGS;
  set(code: Lang) { if (code !== this.lang) setLang(code); }
}
