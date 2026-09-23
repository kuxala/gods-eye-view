// Shared info card for MilitarySpend.org layers (Iran War group). One DOM
// card for all of them: the world-overlay readout is canvas-painted and
// can't hold a real, focusable link.
//
// @typedef {object} MsInfoCardLink
// @property {string} href
// @property {string} label
//
// @typedef {object} MsInfoCard
// @property {string} owner Layer id that currently owns the card.
// @property {string} title
// @property {Array<[string, string]>} [rows]
// @property {string} [note]
// @property {MsInfoCardLink} [link]

let _card = null;
let _titleEl = null;
let _rowsEl = null;
let _noteEl = null;
let _linkEl = null;
let _owner = null;

function ensureCard() {
  if (_card) return _card;
  _card = document.createElement('aside');
  _card.id = 'ms-info-card';
  _card.setAttribute('role', 'dialog');
  _card.setAttribute('aria-label', 'MilitarySpend.org details');
  _card.hidden = true;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ms-info-card-close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.addEventListener('click', () => hideInfoCard());
  _card.appendChild(closeButton);

  _titleEl = document.createElement('h3');
  _titleEl.className = 'ms-info-card-title';
  _card.appendChild(_titleEl);

  _rowsEl = document.createElement('div');
  _rowsEl.className = 'ms-info-card-rows';
  _card.appendChild(_rowsEl);

  _noteEl = document.createElement('p');
  _noteEl.className = 'ms-info-card-note';
  _card.appendChild(_noteEl);

  _linkEl = document.createElement('a');
  _linkEl.className = 'ms-info-card-link';
  _linkEl.target = '_blank';
  _linkEl.rel = 'noopener';
  _card.appendChild(_linkEl);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideInfoCard();
  });

  document.body.appendChild(_card);
  return _card;
}

/** @param {MsInfoCard} card */
export function showInfoCard(card) {
  if (!card?.owner || !card?.title) return;
  ensureCard();
  _owner = card.owner;
  _titleEl.textContent = card.title;

  _rowsEl.replaceChildren();
  for (const [label, value] of card.rows || []) {
    const labelEl = document.createElement('span');
    labelEl.className = 'ms-info-card-row-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'ms-info-card-row-value';
    valueEl.textContent = value;
    _rowsEl.append(labelEl, valueEl);
  }

  if (card.note) {
    _noteEl.textContent = card.note;
    _noteEl.hidden = false;
  } else {
    _noteEl.textContent = '';
    _noteEl.hidden = true;
  }

  if (card.link?.href) {
    _linkEl.href = card.link.href;
    _linkEl.textContent = card.link.label || card.link.href;
    _linkEl.hidden = false;
  } else {
    _linkEl.removeAttribute('href');
    _linkEl.textContent = '';
    _linkEl.hidden = true;
  }

  _card.hidden = false;
}

/**
 * Hide the card. With `owner`, only hides if that layer currently owns it
 * (so a sibling layer's click doesn't dismiss a card it doesn't control).
 * No-arg hides unconditionally.
 * @param {string} [owner]
 */
export function hideInfoCard(owner) {
  if (!_card || _card.hidden) return;
  if (owner && _owner !== owner) return;
  _card.hidden = true;
  _owner = null;
}
