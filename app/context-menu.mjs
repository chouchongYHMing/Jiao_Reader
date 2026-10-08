export class ContextMenu {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'reading-context-menu';
    this.element.setAttribute('role', 'menu');
    this.element.hidden = true;
    document.body.append(this.element);
    document.addEventListener('pointerdown', event => {
      if (!this.element.contains(event.target)) this.close();
    }, true);
    document.addEventListener('keydown', event => {
      if (this.element.hidden) return;
      const buttons = [...this.element.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
      if (event.key === 'Tab') this.close();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    });
    window.addEventListener('resize', () => this.close());
    window.addEventListener('blur', () => this.close());
    document.addEventListener('scroll', () => this.close(), true);
  }

  open(event, entries) {
    event.preventDefault();
    event.stopPropagation();
    this.trigger = event.currentTarget;
    this.element.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = entry.label;
      button.disabled = Boolean(entry.disabled);
      button.addEventListener('click', () => { this.close(); entry.action(); });
      this.element.append(button);
    }
    this.element.hidden = false;
    const rect = this.element.getBoundingClientRect();
    const anchor = this.trigger.getBoundingClientRect();
    const x = event.clientX || anchor.left;
    const y = event.clientY || anchor.bottom;
    this.element.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    this.element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    this.element.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  close(restoreFocus = false) {
    this.element.hidden = true;
    if (restoreFocus && this.trigger?.isConnected) this.trigger.focus?.({ preventScroll: true });
  }
}
