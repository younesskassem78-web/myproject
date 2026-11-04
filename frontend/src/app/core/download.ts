import { HttpResponse } from '@angular/common/http';

/** Saves a file the server sent (name from its Content-Disposition header). */
export function saveFile(r: HttpResponse<Blob>) {
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'myterra.csv';
  const url = URL.createObjectURL(r.body!);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
