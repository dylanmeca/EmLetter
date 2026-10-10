/* EmLetter: selector HEX personalizado para el editor, el diseño y las atmósferas.
   Los inputs originales permanecen en el DOM para reutilizar los eventos del editor. */
(() => {
  'use strict';

  const hues = [
    ['Vino', 350], ['Carmesí', 8], ['Terracota', 21], ['Ámbar', 37],
    ['Oliva', 69], ['Bosque', 128], ['Jade', 160], ['Petróleo', 186],
    ['Acero', 210], ['Índigo', 240], ['Amatista', 273], ['Orquídea', 304], ['Rosa ceniza', 326]
  ];
  const neutral = [
    '#090c13', '#141a24', '#252936', '#39404c', '#59606d', '#818795', '#b1b2b9', '#e3dfd9'
  ];
  // Tintes deliberadamente apagados, en cinco niveles de luminosidad.
  const tonalities = [
    [26, 13], [34, 22], [42, 33], [47, 48], [35, 69]
  ];
  const hex = value => {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + [...raw].map(n => n+n).join('').toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toUpperCase();
    return null;
  };
  const hslToHex = (h, s, l) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const fn = n => {
      const k = (n + h / 30) % 12;
      const channel = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * channel).toString(16).padStart(2, '0');
    };
    return ('#' + fn(0) + fn(8) + fn(4)).toUpperCase();
  };

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function init() {
    const inputs = [...document.querySelectorAll('#composer input[type="color"], #atmosphere-dialog input[type="color"]')];
    if (!inputs.length) return;

    const picker = make('dialog', 'gothic-palette-dialog');
    picker.setAttribute('aria-labelledby', 'gothic-palette-title');
    picker.innerHTML = `
      <form id="gothic-palette-form" novalidate>
        <header class="gothic-palette-heading">
          <div><span class="gothic-palette-kicker">EMLETTER · CROMÁTICA</span>
            <h2 id="gothic-palette-title">Paleta gótica</h2>
            <p id="gothic-palette-subtitle"></p></div>
          <button type="button" class="gothic-palette-close" aria-label="Cerrar paleta">×</button>
        </header>
        <div class="gothic-palette-scroll">
          <div class="gothic-palette-presets" aria-label="Colores góticos disponibles"></div>
        </div>
        <div class="gothic-palette-footer">
          <div class="gothic-palette-current">
            <span class="gothic-palette-preview" aria-hidden="true"></span>
            <label for="gothic-palette-hex">Color HEX <small>#RRGGBB</small></label>
            <input id="gothic-palette-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="gothic-palette-error" placeholder="#A8BCE8">
          </div>
          <p class="gothic-palette-error" id="gothic-palette-error" role="alert" aria-live="polite"></p>
          <div class="gothic-palette-actions"><button type="button" class="gothic-palette-cancel">Cancelar</button><button type="submit" class="gothic-palette-apply">Aplicar color</button></div>
        </div>
      </form>`;
    document.body.append(picker);

    const presets = picker.querySelector('.gothic-palette-presets');
    const inputHex = picker.querySelector('#gothic-palette-hex');
    const colorPreview = picker.querySelector('.gothic-palette-preview');
    const error = picker.querySelector('#gothic-palette-error');
    const subtitle = picker.querySelector('#gothic-palette-subtitle');
    let target = null;
    let returnFocus = null;
    let selected = null;

    const colorButtons = [];
    function addFamily(name, colors) {
      const family = make('div', 'gothic-palette-family');
      const heading = make('span', 'gothic-palette-family-name', name);
      family.append(heading);
      const grid = make('div', 'gothic-palette-colors');
      for (const color of colors) {
        const button = make('button', 'gothic-palette-swatch');
        button.type = 'button';
        button.style.backgroundColor = color;
        button.title = `${name} · ${color}`;
        button.setAttribute('aria-label', `${name}, ${color}`);
        button.dataset.hex = color;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => choose(color));
        colorButtons.push(button);
        grid.append(button);
      }
      family.append(grid);
      presets.append(family);
    }
    addFamily('Sombras · ceniza', neutral);
    hues.forEach(([name, h]) => addFamily(name, tonalities.map(([s, l]) => hslToHex(h, s, l))));

    function labelOf(colorInput) {
      return colorInput.dataset.gothicLabel || colorInput.getAttribute('aria-label') ||
        colorInput.closest('label')?.textContent?.trim().replace(/\s+/g, ' ') ||
        'Color de la carta';
    }
    function choose(value) {
      const valid = hex(value);
      selected = valid;
      inputHex.value = valid || String(value);
      error.textContent = '';
      inputHex.removeAttribute('aria-invalid');
      colorPreview.style.backgroundColor = valid || 'transparent';
      colorButtons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.hex === valid));
      });
    }
    function open(colorInput, trigger) {
      if (picker.open) return;
      target = colorInput;
      returnFocus = trigger;
      subtitle.textContent = labelOf(colorInput);
      choose(colorInput.value || '#A8BCE8');
      picker.showModal();
    }
    function sync(colorInput) {
      const current = hex(colorInput.value) || '#A8BCE8';
      const trigger = colorInput._gothicTrigger;
      if (!trigger) return;
      trigger.style.setProperty('--gothic-color', current);
      const currentText = trigger.querySelector('.gothic-color-value');
      if (currentText) currentText.textContent = current;
      if (trigger.matches('.tool-color')) trigger.title = `${labelOf(colorInput)}: ${current}`;
      else trigger.setAttribute('aria-label', `Elegir ${labelOf(colorInput)}. Actual: ${current}`);
    }

    for (const colorInput of inputs) {
      // Evita completamente el diálogo nativo del navegador.
      colorInput.type = 'hidden';
      colorInput.classList.add('gothic-color-original');
      colorInput.tabIndex = -1;
      colorInput.setAttribute('aria-hidden', 'true');
      const label = colorInput.closest('label');
      colorInput.dataset.gothicLabel = labelOf(colorInput);
      const toolbarControl = label?.classList.contains('tool-color');
      let trigger;
      if (toolbarControl) {
        trigger = label;
        trigger.classList.add('gothic-color-tool');
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.tabIndex = 0;
        trigger.addEventListener('click', e => { e.preventDefault(); open(colorInput, trigger); });
        trigger.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(colorInput, trigger); }
        });
      } else {
        trigger = make('button', 'gothic-color-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.innerHTML = '<span class="gothic-color-dot" aria-hidden="true"></span><span class="gothic-color-value"></span><span class="gothic-color-chevron" aria-hidden="true">⌄</span>';
        colorInput.after(trigger);
        trigger.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(colorInput, trigger); });
      }
      colorInput._gothicTrigger = trigger;
      colorInput.addEventListener('input', () => sync(colorInput));
      colorInput.addEventListener('change', () => sync(colorInput));
      sync(colorInput);
    }

    picker.querySelector('.gothic-palette-close').addEventListener('click', () => picker.close());
    picker.querySelector('.gothic-palette-cancel').addEventListener('click', () => picker.close());
    picker.addEventListener('close', () => {
      if (picker.open) return; // Ignora un cierre antiguo si ya se abrió de nuevo.
      returnFocus?.focus({preventScroll: true});
      target = null;
    });
    picker.addEventListener('click', event => {
      if (event.target === picker) picker.close();
    });
    inputHex.addEventListener('input', () => {
      const valid = hex(inputHex.value);
      selected = valid;
      colorPreview.style.backgroundColor = valid || 'transparent';
      error.textContent = '';
      inputHex.removeAttribute('aria-invalid');
      colorButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.hex === valid)));
    });
    picker.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const value = hex(inputHex.value);
      if (!value || !target) {
        inputHex.setAttribute('aria-invalid', 'true');
        error.textContent = 'Escribe un HEX válido, por ejemplo #7A4059 o #7A4.';
        inputHex.focus();
        return;
      }
      target.value = value.toLowerCase();
      // Los manejadores existentes consumen input (diseño/atmósfera)
      // o change (color y resaltado de la selección Tiptap).
      target.dispatchEvent(new Event('input', {bubbles: true}));
      target.dispatchEvent(new Event('change', {bubbles: true}));
      sync(target);
      picker.close();
    });

    // Los presets del editor se vuelcan por JS sin disparar eventos de input.
    // Escuchamos únicamente la actualización de variables CSS para refrescar los chips.
    let queued = false;
    const updateAll = () => {
      queued = false;
      inputs.forEach(sync);
    };
    new MutationObserver(() => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(updateAll);
      }
    }).observe(document.documentElement, {attributes: true, attributeFilter: ['style']});
    const atmosphereDialog = document.getElementById('atmosphere-dialog');
    if (atmosphereDialog) {
      new MutationObserver(() => requestAnimationFrame(updateAll))
        .observe(atmosphereDialog, {attributes: true, attributeFilter: ['open']});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
