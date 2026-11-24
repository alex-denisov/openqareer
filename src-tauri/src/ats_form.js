(function () {
  var OP = __OQ_ATS_OP__;
  var ARG = __OQ_ATS_ARG__;
  var FORM_SELECTORS = ['form#application-form', 'form#application_form'];
  var CONTROLS = 'input, select, textarea';
  var SKIPPED_TYPES = ['hidden', 'submit', 'button', 'image', 'reset'];
  var CAPTCHA_FRAMES =
    'iframe[src*="recaptcha"][src*="bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[src*="challenges.cloudflare.com"]';
  var MENU_WAIT_MS = 120;
  var MENU_TRIES = 15;

  function text(node) {
    return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function shown(node) {
    return node.getClientRects().length > 0;
  }
  function findForm() {
    for (var i = 0; i < FORM_SELECTORS.length; i += 1) {
      var known = document.querySelector(FORM_SELECTORS[i]);
      if (known) return known;
    }
    var forms = Array.prototype.slice.call(document.forms);
    var withFile = forms.filter(function (form) {
      return form.querySelector('input[type="file"]');
    });
    if (withFile.length === 1) return withFile[0];
    return forms.length === 1 ? forms[0] : null;
  }
  function byIds(ids) {
    return (ids || '')
      .split(/\s+/)
      .map(function (id) {
        return id ? text(document.getElementById(id)) : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  function groupOf(node) {
    return node.closest('[role="group"], [role="radiogroup"], fieldset');
  }
  function groupLabel(node) {
    var group = groupOf(node);
    if (!group) return '';
    return byIds(group.getAttribute('aria-labelledby')) || text(group.querySelector('legend'));
  }
  function labelFor(node) {
    if (!node.id) return null;
    return (
      Array.prototype.slice.call(document.querySelectorAll('label[for]')).filter(function (label) {
        return label.htmlFor === node.id;
      })[0] || null
    );
  }
  function ownLabel(node) {
    var forLabel = labelFor(node);
    return (
      byIds(node.getAttribute('aria-labelledby')) ||
      node.getAttribute('aria-label') ||
      text(forLabel) ||
      text(node.closest('label'))
    );
  }
  function kindOf(node) {
    if (node.tagName === 'SELECT') return 'select';
    if (node.tagName === 'TEXTAREA') return 'textarea';
    if (node.getAttribute('role') === 'combobox') return 'combobox';
    var type = (node.getAttribute('type') || 'text').toLowerCase();
    return [
      'file',
      'checkbox',
      'radio',
      'email',
      'tel',
      'url',
      'number',
      'date',
      'password',
    ].indexOf(type) >= 0
      ? type
      : 'text';
  }
  function keyOf(node, kind) {
    if (kind === 'radio' && node.name) return 'name:' + node.name;
    if (node.id) return 'id:' + node.id;
    return node.name ? 'name:' + node.name : '';
  }
  function isRequired(node, label) {
    var group = groupOf(node);
    return (
      node.required ||
      node.getAttribute('aria-required') === 'true' ||
      Boolean(group && group.getAttribute('aria-required') === 'true') ||
      /\*\s*$/.test(label)
    );
  }
  function controls(form) {
    return Array.prototype.slice.call(form.querySelectorAll(CONTROLS)).filter(function (node) {
      var type = (node.getAttribute('type') || '').toLowerCase();
      return (
        SKIPPED_TYPES.indexOf(type) < 0 &&
        node.getAttribute('aria-hidden') !== 'true' &&
        !node.disabled
      );
    });
  }
  function linkOf(node) {
    var holder = node.closest('label') || labelFor(node);
    var link = holder ? holder.querySelector('a[href]') : null;
    return link ? link.href : null;
  }
  function optionsOf(node, kind, form) {
    if (kind === 'select') {
      return Array.prototype.slice.call(node.options).map(function (option) {
        return { value: option.value, label: text(option) };
      });
    }
    if (kind === 'radio') {
      return radios(form, node.name).map(function (radio) {
        return { value: radio.value, label: ownLabel(radio) };
      });
    }
    return [];
  }
  function radios(form, name) {
    return Array.prototype.slice
      .call(form.querySelectorAll('input[type="radio"]'))
      .filter(function (radio) {
        return radio.name === name;
      });
  }
  function submitButtons(form) {
    return Array.prototype.slice
      .call(
        form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])'),
      )
      .filter(shown);
  }
  function captcha() {
    return Array.prototype.slice.call(document.querySelectorAll(CAPTCHA_FRAMES)).some(shown);
  }

  function readFields(form) {
    var seen = {};
    var fields = [];
    var unkeyed = 0;
    controls(form).forEach(function (node) {
      var kind = kindOf(node);
      var key = keyOf(node, kind);
      if (!key) {
        unkeyed += 1;
        return;
      }
      if (seen[key]) return;
      seen[key] = true;
      var grouped = kind === 'file' || kind === 'radio';
      var label = (grouped && groupLabel(node)) || ownLabel(node) || groupLabel(node);
      fields.push({
        key: key,
        label: label.replace(/\s*\*\s*$/, ''),
        kind: kind,
        role: node.getAttribute('role'),
        required: isRequired(node, label),
        options: optionsOf(node, kind, form),
        accept: kind === 'file' ? node.getAttribute('accept') : null,
        link: kind === 'checkbox' ? linkOf(node) : null,
      });
    });
    return { fields: fields, unkeyed: unkeyed };
  }
  function read() {
    var form = findForm();
    var base = { host: location.hostname, path: location.pathname, captcha: captcha() };
    if (!form) {
      base.state = document.querySelector('input[type="password"]')
        ? 'account_required'
        : 'form_missing';
      return base;
    }
    var result = readFields(form);
    var buttons = submitButtons(form);
    base.state = form.querySelector('input[type="password"]') ? 'account_required' : 'ready';
    base.fields = result.fields;
    base.unkeyed = result.unkeyed;
    base.submitButtons = buttons.length;
    base.submitLabel = buttons.length === 1 ? text(buttons[0]) || buttons[0].value || '' : '';
    return base;
  }

  function nodeFor(form, key) {
    var name = key.slice(key.indexOf(':') + 1);
    if (key.indexOf('id:') === 0) {
      var node = document.getElementById(name);
      return node && form.contains(node) ? node : null;
    }
    return (
      controls(form).filter(function (candidate) {
        return candidate.name === name;
      })[0] || null
    );
  }
  function valueOf(form, node) {
    var kind = kindOf(node);
    if (kind === 'checkbox') return node.checked ? 'true' : 'false';
    if (kind === 'radio') {
      var picked = radios(form, node.name).filter(function (radio) {
        return radio.checked;
      })[0];
      return picked ? picked.value : '';
    }
    if (kind === 'file') {
      var file = node.files && node.files[0];
      return file ? file.name + ':' + file.size : '';
    }
    if (kind === 'combobox') {
      var shell = node.closest('.select__control') || node.parentElement;
      return text(
        shell && shell.querySelector('.select__single-value, .select__multi-value__label'),
      );
    }
    return node.value;
  }
  function snapshot() {
    var form = findForm();
    if (!form) return { state: 'form_missing', values: {} };
    var values = {};
    readFields(form).fields.forEach(function (field) {
      var node = nodeFor(form, field.key);
      if (node) values[field.key] = valueOf(form, node);
    });
    return { state: 'ready', values: values };
  }

  function fire(node, type) {
    node.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function setText(node, value) {
    var proto =
      node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    fire(node, 'input');
    fire(node, 'change');
    fire(node, 'blur');
  }
  function setSelect(node, value) {
    var option = Array.prototype.slice.call(node.options).filter(function (candidate) {
      return candidate.value === value || text(candidate) === value;
    })[0];
    if (!option) return 'option_missing';
    node.value = option.value;
    fire(node, 'input');
    fire(node, 'change');
    return 'set';
  }
  function setFile(node, file) {
    try {
      var binary = atob(file.base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      var transfer = new DataTransfer();
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
      node.files = transfer.files;
      fire(node, 'input');
      fire(node, 'change');
      return node.files.length === 1 && node.files[0].size === bytes.length
        ? 'set'
        : 'file_not_attached';
    } catch (_) {
      return 'file_not_attached';
    }
  }
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function menuOptions(node) {
    var menuId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns');
    var scope =
      (menuId && document.getElementById(menuId)) ||
      node.closest('.select-shell, .select') ||
      document;
    return Array.prototype.slice.call(scope.querySelectorAll('[role="option"], .select__option'));
  }
  async function setCombobox(node, value) {
    var control = node.closest('.select__control') || node;
    control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    for (var attempt = 0; attempt < MENU_TRIES; attempt += 1) {
      await wait(MENU_WAIT_MS);
      var options = menuOptions(node);
      if (options.length === 0) continue;
      var match = options.filter(function (option) {
        return text(option) === value;
      })[0];
      if (!match) {
        fire(node, 'blur');
        return 'option_missing';
      }
      match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      match.click();
      return 'set';
    }
    return 'menu_missing';
  }
  async function setOne(form, entry) {
    var node = nodeFor(form, entry.key);
    if (!node) return 'field_missing';
    var kind = kindOf(node);
    if (kind === 'file') return entry.file ? setFile(node, entry.file) : 'file_missing';
    if (kind === 'checkbox') {
      if (node.checked !== (entry.value === 'true')) node.click();
      return 'set';
    }
    if (kind === 'radio') {
      var radio = radios(form, node.name).filter(function (candidate) {
        return candidate.value === entry.value || ownLabel(candidate) === entry.value;
      })[0];
      if (!radio) return 'option_missing';
      if (!radio.checked) radio.click();
      return 'set';
    }
    if (kind === 'select') return setSelect(node, entry.value);
    if (kind === 'combobox') return setCombobox(node, entry.value);
    setText(node, entry.value);
    return 'set';
  }
  function fill() {
    var form = findForm();
    if (!form) return { state: 'form_missing' };
    var job = { done: false, results: {} };
    window.__oqAtsJob = job;
    (async function () {
      for (var i = 0; i < ARG.entries.length; i += 1) {
        var entry = ARG.entries[i];
        try {
          job.results[entry.key] = await setOne(form, entry);
        } catch (_) {
          job.results[entry.key] = 'fill_failed';
        }
      }
      job.done = true;
    })();
    return { state: 'started' };
  }
  function job() {
    var current = window.__oqAtsJob;
    return current
      ? { done: current.done, results: current.results }
      : { done: false, missing: true };
  }

  function submit() {
    if (window.__oqAtsSubmitted) return { state: 'already_submitted' };
    var form = findForm();
    if (!form) return { state: 'form_missing' };
    if (captcha()) return { state: 'captcha' };
    var buttons = submitButtons(form);
    if (buttons.length !== 1) return { state: 'submit_ambiguous', count: buttons.length };
    if (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') {
      return { state: 'submit_disabled' };
    }
    window.__oqAtsSubmitted = true;
    buttons[0].click();
    return { state: 'clicked' };
  }
  function outcome() {
    var confirmPath = ARG && ARG.confirmationPath;
    var here = location.pathname.replace(/\/+$/, '');
    if (confirmPath && here === confirmPath) return { state: 'confirmed', path: location.pathname };
    var form = findForm();
    if (captcha()) return { state: 'captcha' };
    if (form) {
      var invalid = Array.prototype.slice
        .call(form.querySelectorAll('[aria-invalid="true"]'))
        .map(function (node) {
          return keyOf(node, kindOf(node));
        })
        .filter(Boolean);
      if (invalid.length > 0) return { state: 'invalid', keys: invalid };
    }
    return { state: 'pending' };
  }

  var ops = {
    read: read,
    snapshot: snapshot,
    fill: fill,
    job: job,
    submit: submit,
    outcome: outcome,
  };
  try {
    return JSON.stringify(ops[OP] ? ops[OP]() : { state: 'unknown_op' });
  } catch (_) {
    return JSON.stringify({ state: 'script_failed' });
  }
})();
