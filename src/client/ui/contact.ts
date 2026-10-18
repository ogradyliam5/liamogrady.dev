/** Contact / CV-request form: progressive enhancement over a plain POST. */
type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; getResponse: (id?: string) => string | undefined; reset: (id?: string) => void };

export function wireContact() {
  const form = document.querySelector<HTMLFormElement>('[data-contact]');
  if (!form) return;
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const message = form.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!;
  const setStatus = (text: string, kind: '' | 'ok' | 'bad' = '') => {
    status.textContent = text;
    status.className = `form-status${kind ? ` is-${kind}` : ''}`;
  };
  const syncKind = () => {
    const kind = (form.elements.namedItem('kind') as RadioNodeList).value;
    message.required = kind === 'hello';
    message.placeholder = kind === 'cv' ? 'Optional: the role or project you have in mind' : 'What are you working on?';
  };
  form.addEventListener('change', syncKind);
  syncKind();

  // Turnstile only loads if the site key is configured (data attribute set by the Worker or build).
  const slot = form.querySelector<HTMLElement>('[data-turnstile]');
  const siteKey = slot?.dataset.sitekey;
  let widget: string | undefined;
  if (slot && siteKey) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => {
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      widget = ts?.render(slot, { sitekey: siteKey, theme: 'dark', size: 'flexible', action: 'contact' });
    };
    document.head.append(s);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (widget && ts) data.turnstile = ts.getResponse(widget) ?? '';
    setStatus('Sending…');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; mailto?: string };
      if (body.ok) {
        setStatus(data.kind === 'cv' ? 'Thanks. Liam will send the CV to your inbox.' : 'Thanks. Liam will reply soon.', 'ok');
        form.reset();
        syncKind();
      } else if (body.mailto) {
        setStatus('The form is not wired up yet, so your email app will open instead.', '');
        location.href = body.mailto;
      } else {
        setStatus(body.error === 'rate_limited' ? 'Easy there. Try again in a minute.' : 'That did not send. Please email me directly.', 'bad');
      }
    } catch {
      setStatus('You seem to be offline. Please email me directly.', 'bad');
    } finally {
      button.disabled = false;
      if (widget && ts) ts.reset(widget);
    }
  });
}
