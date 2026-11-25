(function () {
  var OP = __OQ_ATS_OP__;
  var ARG = __OQ_ATS_ARG__;
  // One board family per entry, known by its own markup. `block` is one question,
  // `title` its label, `mark` a required sign that is not an attribute.
  var PROFILES = [
    {
      root: '.ashby-application-form-container',
      scope: ashbyScope,
      block: '[data-field-path]',
      title: '.ashby-application-form-question-title',
      mark: '.ashby-application-form-question-title[class*="_required_"]',
      submit: '.ashby-application-form-submit-button',
      skip: '[class*="ashby-application-form-autofill-input"]',
      groupChecks: true,
    },
    {
      root: 'form#application-form .application-question',
      scope: formScope,
      block: '.application-question, .application-additional',
      title: '.application-label',
      mark: '.application-label .required',
      submit: '#btn-submit, button.template-btn-submit',
      skip: '#hcaptchaSubmitBtn',
    },
    {
      root: 'form#offer-application-form',
      byName: true,
      ownFileLabel: true,
      submit: '[data-testid="submit-application-form-button"]',
    },
    {
      root: 'form#job-application-form [data-fabric-component]',
      scope: formScope,
      block: '[data-fabric-component$="InputWrapper"]',
      title: 'label',
      // A robot trap lives in a block hidden from readers.
      skip: '[aria-hidden="true"]',
      byName: true,
      menuButtons: true,
      fileBox: '[data-fabric-component="FileUpload"]',
      submit:
        'form#job-application-form button[type="submit"], button[form="job-application-form"]',
      byHand: true,
    },
    {
      root: 'form .navigation-buttons .bzyButtonColor',
      scope: formScope,
      block: '.question',
      title: 'h3',
      above: 'h3',
      names: { cResume: 'Resume' },
      skip: '.apply-field-extra, [aria-hidden="true"]',
      byName: true,
      submit: '.navigation-buttons button',
      byHand: true,
    },
    {
      root: 'oc-oneclick-form-root',
      deep: true,
      title: 'label',
      skip: 'oc-easy-apply, oc-avatar, spl-dropdown-search',
      section: 'oc-resume-upload',
      submit: '[data-test="footer-submit"]',
      next: '[data-test="footer-next"]',
    },
    {
      root: 'form#job-application-form',
      drop: '.sr-only, [data-asterisk]',
      mark: '[data-asterisk]',
      // The board sends the file away at once; its address takes the field's place.
      uploaded: '[data-forms--inputs--upload-preview-target="urlInput"]',
      unload: '[data-dz-remove]',
      uploader: '[data-controller~="forms--inputs--upload"]',
    },
    {
      root: 'form#application-form.external-form',
      block: '[class*="col-md"]',
      title: '.external-form__label--required, .external-form__label',
      mark: '.external-form__label--required',
    },
    { root: 'form[data-ui="application-form"]', submit: '[data-ui="apply-button"]' },
    { root: 'form#application-form' },
    { root: 'form#application_form' },
  ];
  var NEXT_TEXT =
    /^(next|next step|continue|save (and|&) continue|далее|продолжить|siguiente|suivant|weiter)$/i;
  var BACK_TEXT = /^(back|previous|cancel|назад|отмена)$/i;
  // A trap for robots: the form itself asks to leave it empty.
  var LEAVE_BLANK = /leave (this|it)( field)? (blank|empty)/i;
  var CALLING_CODE = /calling code|country code|dial code|phone code/i;
  var CONTROLS =
    'input, select, textarea, button[role="combobox"], button[aria-haspopup="listbox"], div[role="combobox"]';
  var SKIPPED_TYPES = ['hidden', 'submit', 'button', 'image', 'reset'];
  var MAX_OPTIONS = 300;
  var CAPTCHA_FRAMES =
    'iframe[src*="recaptcha"][src*="bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[src*="challenges.cloudflare.com"], iframe[src*="captcha-delivery.com"], iframe[src*="/captcha/v1/"][src*="frame=challenge"]';
  // A field that takes only a suggestion of its own list and clears anything else.
  var SUGGESTED = 'input.location-input';
  var SUGGESTION = '.dropdown-location';
  var SUGGESTED_TRIES = 40;
  var GENERATED_ID = /^Fabric\w*-\d+$/;
  var HELD_WAIT_MS = 300;
  var HELD_LIMIT_MS = 20000;
  var DATE_MASK = /^(mm|dd|yyyy|\d{2})([./-])(mm|dd|yyyy|\d{2})\2(yyyy|dd|\d{2,4})$/i;
  var HELD_LEVELS = 8;
  var MENU_WAIT_MS = 120;
  var MENU_TRIES = 15;
  var UPLOAD_WAIT_MS = 300;
  var UPLOAD_TRIES = 90;

  function text(node) {
    return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function shown(node) {
    return node.getClientRects().length > 0;
  }
  // Some boards draw their fields inside open shadow trees.
  function findAll(scope, selector) {
    var found = Array.prototype.slice.call(scope.querySelectorAll(selector));
    if (!profile().deep) return found;
    return Array.prototype.slice.call(scope.querySelectorAll('*')).reduce(function (list, node) {
      return node.shadowRoot ? list.concat(findAll(node.shadowRoot, selector)) : list;
    }, found);
  }
  function up(node, selector) {
    for (var at = node; at; at = at.getRootNode().host) {
      var hit = at.closest(selector);
      if (hit) return hit;
    }
    return null;
  }
  function byId(node, id) {
    var root = node && profile().deep ? node.getRootNode() : document;
    return root.getElementById(id);
  }
  // The heading right above a field that has no label of its own.
  function aboveTitle(node) {
    var known = profile();
    for (var at = node; known.above && at && at.tagName !== 'FORM'; at = at.parentElement) {
      for (var prev = at.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.matches('input, textarea, select, .form-divider, .error-container')) break;
        var title = prev.matches(known.above) ? prev : prev.querySelector(known.above);
        if (title) return text(title);
      }
    }
    return '';
  }
  // The name the form itself sends the field under.
  function nameOf(node) {
    var known = profile();
    if (node.name) return node.name;
    var box = known.fileBox ? node.closest(known.fileBox) : null;
    var twin =
      node.tagName === 'BUTTON' && blockOf(node)
        ? blockOf(node).querySelector('select[name]')
        : box && box.querySelector('input[type="hidden"][name]');
    return (twin && twin.name) || '';
  }
  function fileTitle(node) {
    var known = profile();
    if (known.section && up(node, known.section)) {
      return text(up(node, known.section).querySelector('[data-test="section-title"]'));
    }
    var box = known.fileBox ? node.closest(known.fileBox) : null;
    return (box && text(box.parentElement.querySelector('p'))) || '';
  }
  function ashbyScope(container) {
    var button = document.querySelector('.ashby-application-form-submit-button');
    var node = button ? button.parentElement : container;
    while (node && !node.contains(container)) node = node.parentElement;
    return node || container;
  }
  function formScope(node) {
    return node.closest('form');
  }
  function profile() {
    return (
      PROFILES.filter(function (entry) {
        return document.querySelector(entry.root);
      })[0] || {}
    );
  }
  function findForm() {
    var known = profile();
    if (known.root) {
      var root = document.querySelector(known.root);
      return known.scope ? known.scope(root) : root;
    }
    var forms = Array.prototype.slice.call(document.forms);
    var withFile = forms.filter(function (form) {
      return form.querySelector('input[type="file"]');
    });
    if (withFile.length === 1) return withFile[0];
    return forms.length === 1 ? forms[0] : null;
  }
  function byIds(ids, near) {
    return (ids || '')
      .split(/\s+/)
      .map(function (id) {
        return id ? text(byId(near, id)) : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  function groupOf(node) {
    return node.closest('[role="group"], [role="radiogroup"], fieldset');
  }
  function blockOf(node) {
    var known = profile();
    return known.block ? node.closest(known.block) : null;
  }
  function plain(node) {
    var known = profile();
    if (!node || !known.drop) return text(node);
    var copy = node.cloneNode(true);
    Array.prototype.slice.call(copy.querySelectorAll(known.drop)).forEach(function (part) {
      part.remove();
    });
    return text(copy);
  }
  function blockTitle(node) {
    var block = blockOf(node);
    if (block) return text(block.querySelector(profile().title));
    return aboveTitle(node) || (profile().names || {})[node.name] || '';
  }
  function groupLabel(node) {
    var title = blockTitle(node) || fileTitle(node);
    if (title) return title;
    var group = groupOf(node);
    if (!group) return '';
    return (
      byIds(group.getAttribute('aria-labelledby'), group) || text(group.querySelector('legend'))
    );
  }
  function labelFor(node) {
    if (!node.id) return null;
    return (
      Array.prototype.slice
        .call((profile().deep ? node.getRootNode() : document).querySelectorAll('label[for]'))
        .filter(function (label) {
          return label.htmlFor === node.id;
        })[0] || null
    );
  }
  function ownLabel(node) {
    var forLabel = labelFor(node);
    return (
      byIds(node.getAttribute('aria-labelledby'), node) ||
      node.getAttribute('aria-label') ||
      plain(forLabel) ||
      plain(node.closest('label'))
    );
  }
  function isUploaded(node) {
    var known = profile().uploaded;
    return Boolean(known && node.matches(known) && !node.disabled && node.value);
  }
  // The address a board keeps in place of the file it has taken.
  function uploadedFor(form, id) {
    var known = profile().uploaded;
    if (!known) return null;
    return (
      Array.prototype.slice.call(form.querySelectorAll(known)).filter(function (node) {
        return node.id === id && isUploaded(node);
      })[0] || null
    );
  }
  function kindOf(node) {
    if (isUploaded(node)) return 'file';
    if (node.tagName === 'SELECT') return 'select';
    if (node.tagName === 'TEXTAREA') return 'textarea';
    if (node.matches(SUGGESTED)) return 'combobox';
    if (node.getAttribute('role') === 'combobox' || node.tagName === 'BUTTON') return 'combobox';
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
    if (yesNoOf(node) || (kind === 'checkbox_group' && profile().groupChecks)) {
      var path = blockOf(node).getAttribute('data-field-path');
      return path ? 'path:' + path : '';
    }
    var name = nameOf(node);
    if ((kind === 'radio' || kind === 'checkbox_group') && name) return 'name:' + name;
    // Generated ids change on every load of the page.
    if (name && (profile().byName || /radix|^:|:$/.test(node.id))) return 'name:' + name;
    if (!name && GENERATED_ID.test(node.id)) return 'label:' + ownLabel(node).slice(0, 120);
    if (node.id) return 'id:' + node.id;
    return name ? 'name:' + name : '';
  }
  function isRequired(node, label) {
    var group = groupOf(node);
    var mark = profile().mark;
    var place = blockOf(node) || labelFor(node);
    return (
      Boolean(mark && place && (place.matches(mark) || place.querySelector(mark))) ||
      node.required ||
      node.getAttribute('aria-required') === 'true' ||
      Boolean(group && group.getAttribute('aria-required') === 'true') ||
      /[*✱]\s*$/.test(label)
    );
  }
  function controls(form) {
    return findAll(form, CONTROLS).filter(function (node) {
      var type = (node.getAttribute('type') || '').toLowerCase();
      return (
        (SKIPPED_TYPES.indexOf(type) < 0 ||
          (node.tagName === 'BUTTON' && Boolean(profile().menuButtons))) &&
        node.getAttribute('aria-hidden') !== 'true' &&
        !node.disabled &&
        !(profile().skip && up(node, profile().skip)) &&
        !/^(g-recaptcha|h-captcha)-response/.test(node.id + node.name) &&
        !(node.tagName === 'DIV' && node.querySelector('input')) &&
        !(kindOf(node) === 'combobox' && CALLING_CODE.test(ownLabel(node))) &&
        !LEAVE_BLANK.test(ownLabel(node)) &&
        reachable(node, type)
      );
    });
  }
  // A styled file, radio or checkbox may itself be unpainted inside a painted question.
  function reachable(node, type) {
    if (shown(node) || isUploaded(node)) return true;
    // The narrow-screen twin of a list that is already on the page.
    if (node.tagName === 'SELECT' && node.closest('div').querySelector('[role="combobox"]')) {
      return false;
    }
    var styled = ['file', 'radio', 'checkbox'].indexOf(type) >= 0 || node.tagName === 'SELECT';
    if (!styled) return false;
    return Boolean(node.parentElement && shown(node.parentElement));
  }
  function yesNoOf(node) {
    return node.closest('.ashby-application-form-input-yesno');
  }
  function yesNoButtons(node) {
    return Array.prototype.slice.call(yesNoOf(node).querySelectorAll('button[data-option]'));
  }
  // The checkboxes that answer one question together, or just the node itself.
  function checksOf(form, node) {
    var block = profile().groupChecks ? blockOf(node) : null;
    return controls(form).filter(function (other) {
      if (kindOf(other) !== 'checkbox') return false;
      if (block) return blockOf(other) === block;
      return other === node || Boolean(node.name && other.name === node.name);
    });
  }
  function fieldKind(form, node) {
    var kind = kindOf(node);
    if (kind !== 'checkbox') return kind;
    if (yesNoOf(node)) return 'radio';
    return checksOf(form, node).length > 1 ? 'checkbox_group' : kind;
  }
  function choices(nodes) {
    var values = nodes.map(function (node) {
      return node.value;
    });
    var distinct = values.every(function (value, index) {
      return value && values.indexOf(value) === index;
    });
    return nodes.map(function (node) {
      var label = ownLabel(node);
      return { node: node, value: distinct && nodes.length > 1 ? node.value : label, label: label };
    });
  }
  function bare(list) {
    return list.map(function (choice) {
      return { value: choice.value, label: choice.label };
    });
  }
  function picked(list) {
    return list
      .filter(function (choice) {
        return choice.node.checked;
      })
      .map(function (choice) {
        return choice.value;
      });
  }
  function linkOf(node) {
    var holder = node.closest('label') || labelFor(node);
    var link = holder ? holder.querySelector('a[href]') : null;
    return link ? link.href : null;
  }
  function optionsOf(node, kind, form) {
    if (kind === 'checkbox_group') return bare(choices(checksOf(form, node)));
    if (kind === 'radio' && yesNoOf(node)) {
      return yesNoButtons(node).map(function (button) {
        return { value: text(button), label: text(button) };
      });
    }
    if (kind === 'select') {
      return Array.prototype.slice.call(node.options).map(function (option) {
        return { value: option.value, label: text(option) };
      });
    }
    if (kind === 'radio') {
      return bare(choices(radios(form, node.name)));
    }
    return [];
  }
  function radios(form, name) {
    return Array.prototype.slice
      .call(findAll(form, 'input[type="radio"]'))
      .filter(function (radio) {
        return radio.name === name;
      });
  }
  function caption(button) {
    var host = profile().deep && button.getRootNode().host;
    return (
      text(button) ||
      (host && text(host)) ||
      button.value ||
      button.getAttribute('aria-label') ||
      ''
    );
  }
  function submitButtons(form) {
    var known = profile().submit;
    if (profile().deep) return footerButtons(form, known);
    var found = known
      ? findAll(document, known)
      : form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])');
    return Array.prototype.slice.call(found).filter(function (button) {
      var label = caption(button);
      return (
        shown(button) &&
        button.getAttribute('role') !== 'combobox' &&
        button.getAttribute('aria-haspopup') !== 'listbox' &&
        !NEXT_TEXT.test(label) &&
        !BACK_TEXT.test(label)
      );
    });
  }
  // A button drawn inside the shadow tree of its named holder.
  function footerButtons(form, holder) {
    return findAll(form, 'button').filter(function (button) {
      return shown(button) && up(button, holder);
    });
  }
  function nextButtons(form) {
    if (profile().next) return footerButtons(form, profile().next);
    return Array.prototype.slice
      .call(form.querySelectorAll('button, input[type="submit"], input[type="button"]'))
      .filter(function (button) {
        return shown(button) && NEXT_TEXT.test(caption(button));
      });
  }
  // Check frames are parked off screen until they ask something.
  function captcha() {
    return Array.prototype.slice
      .call(document.querySelectorAll(CAPTCHA_FRAMES))
      .some(function (frame) {
        var parked = frame.getBoundingClientRect().bottom + window.scrollY < 0;
        return shown(frame) && !parked && getComputedStyle(frame).visibility !== 'hidden';
      });
  }

  function readFields(form) {
    var seen = {};
    var fields = [];
    var unkeyed = 0;
    controls(form).forEach(function (node) {
      var kind = fieldKind(form, node);
      var key = keyOf(node, kind);
      if (!key) {
        unkeyed += 1;
        return;
      }
      if (seen[key]) return;
      seen[key] = true;
      var grouped =
        (kind === 'file' && !profile().ownFileLabel) ||
        kind === 'radio' ||
        kind === 'checkbox_group';
      var label =
        (grouped && groupLabel(node)) ||
        (kind !== 'checkbox' && blockTitle(node)) ||
        ownLabel(node) ||
        groupLabel(node);
      fields.push({
        key: key,
        label: label.replace(/\s*[*✱]\s*$/, ''),
        kind: kind,
        role: node.getAttribute('role'),
        required: isRequired(node, label),
        autocomplete: node.getAttribute('autocomplete'),
        options: optionsOf(node, kind, form),
        accept: kind === 'file' ? node.getAttribute('accept') : null,
        link: kind === 'checkbox' ? linkOf(node) : null,
      });
    });
    return { fields: fields, unkeyed: unkeyed };
  }
  // BambooHR shows the form only after this press; the button sends nothing.
  function openForm() {
    if (!inPlace()) return;
    if (window.__oqAtsOpened || !/^\/careers\/\d+\/?$/.test(location.pathname)) return;
    if (!document.querySelector('[data-fabric-component]')) return;
    var openers = Array.prototype.slice
      .call(document.querySelectorAll('button'))
      .filter(function (button) {
        return shown(button) && /^apply for this job$/i.test(text(button));
      });
    // The page repeats the same button at its top and bottom.
    if (openers.length === 0) return;
    window.__oqAtsOpened = true;
    openers[0].click();
  }
  // The page draws its file fields after its scripts have come.
  function drawn(form) {
    var known = profile().uploader;
    if (!known) return true;
    return Array.prototype.slice.call(form.querySelectorAll(known)).every(function (box) {
      return box.querySelector('input[type="file"]') || box.querySelector(profile().uploaded);
    });
  }
  function read() {
    var form = findForm();
    var base = { host: location.hostname, path: location.pathname, captcha: captcha() };
    if (!form) {
      openForm();
      base.state = document.querySelector('input[type="password"]')
        ? 'account_required'
        : 'form_missing';
      return base;
    }
    var result = readFields(form);
    var buttons = submitButtons(form);
    base.state = form.querySelector('input[type="password"]') ? 'account_required' : 'ready';
    if (!drawn(form)) base.state = 'loading';
    base.fields = result.fields;
    base.loaded = document.readyState === 'complete';
    base.unkeyed = result.unkeyed;
    base.submitButtons = buttons.length;
    base.submitLabel = buttons.length === 1 ? caption(buttons[0]) : '';
    base.step = nextButtons(form).length > 0 ? 'next' : 'submit';
    base.signature = signature(form);
    return base;
  }
  function signature(form) {
    return (
      location.pathname +
      '|' +
      readFields(form)
        .fields.map(function (field) {
          return field.key;
        })
        .join('|')
    );
  }

  function nodeFor(form, key) {
    var name = key.slice(key.indexOf(':') + 1);
    if (key.indexOf('id:') === 0 && profile().deep) {
      return (
        controls(form).filter(function (candidate) {
          return candidate.id === name;
        })[0] || null
      );
    }
    var uploaded = key.indexOf('id:') === 0 && uploadedFor(form, name);
    if (uploaded) return uploaded;
    if (key.indexOf('id:') === 0) {
      var node = document.getElementById(name);
      return node && form.contains(node) ? node : null;
    }
    return (
      controls(form).filter(function (candidate) {
        if (key.indexOf('path:') === 0) {
          var block = blockOf(candidate);
          return Boolean(block) && block.getAttribute('data-field-path') === name;
        }
        if (key.indexOf('label:') === 0) return keyOf(candidate, kindOf(candidate)) === key;
        return nameOf(candidate) === name;
      })[0] || null
    );
  }
  function valueOf(form, node) {
    var kind = fieldKind(form, node);
    if (kind === 'checkbox_group') return picked(choices(checksOf(form, node))).join('\n');
    if (kind === 'radio' && yesNoOf(node)) {
      return yesNoButtons(node)
        .filter(function (button) {
          return button.getAttribute('aria-pressed') === 'true';
        })
        .map(text)
        .join('');
    }
    if (kind === 'checkbox') return node.checked ? 'true' : 'false';
    if (kind === 'radio') {
      return picked(choices(radios(form, node.name)))[0] || '';
    }
    if (isUploaded(node)) return node.value.split('/').pop().slice(-200);
    if (kind === 'file') {
      var file = node.files && node.files[0];
      return file ? file.name + ':' + file.size : '';
    }
    if (kind === 'combobox') {
      var shell = node.closest('[class*="select__control"]');
      if (shell) {
        return text(shell.querySelector('[class*="single-value"], [class*="multi-value__label"]'));
      }
      return node.tagName === 'INPUT' ? node.value : text(node);
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
    Object.keys(heldFiles()).forEach(function (key) {
      if (!values[key] && isHeld(key)) values[key] = heldFiles()[key].value;
    });
    return { state: 'ready', values: values };
  }

  function fire(node, type) {
    node.dispatchEvent(new Event(type, { bubbles: true }));
  }
  // A date written the way the field itself spells it.
  function dateFor(node, value) {
    var date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    var mask = [node.value, node.placeholder].filter(function (hint) {
      return hint && /[mdy]/i.test(hint) && DATE_MASK.test(hint);
    })[0];
    if (!date || !mask) return value;
    return mask
      .toLowerCase()
      .replace('yyyy', date[1])
      .replace('mm', date[2])
      .replace('dd', date[3]);
  }
  function setText(node, text) {
    var value = dateFor(node, text);
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
  // A file already taken makes room for the new one.
  async function emptyFile(form, node) {
    var box = isUploaded(node) && node.closest('.dz-preview, [data-controller]');
    var button = box && box.querySelector(profile().unload);
    if (!button) return isUploaded(node) ? null : node;
    var id = node.id;
    button.click();
    for (var attempt = 0; attempt < MENU_TRIES; attempt += 1) {
      await wait(MENU_WAIT_MS);
      var fresh = uploadedFor(form, id) ? null : document.getElementById(id);
      if (fresh && fresh.type === 'file' && !fresh.disabled) return fresh;
    }
    return null;
  }
  async function setUpload(form, node, file) {
    var id = node.id;
    var input = await emptyFile(form, node);
    if (!input) return 'file_not_attached';
    var result = setFile(input, file);
    // The board may have swapped the field while it was being set.
    if (result !== 'set' && input.isConnected) return result;
    for (var attempt = 0; attempt < UPLOAD_TRIES; attempt += 1) {
      if (uploadedFor(form, id)) {
        await wait(MENU_WAIT_MS);
        return 'set';
      }
      await wait(UPLOAD_WAIT_MS);
    }
    return 'upload_failed';
  }
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function menuOptions(node) {
    if (node.matches(SUGGESTED)) {
      return Array.prototype.slice.call(node.parentNode.querySelectorAll(SUGGESTION)).filter(shown);
    }
    var menuId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns');
    var scope =
      (menuId && byId(node, menuId)) ||
      node.closest('.select-shell, .select, .react-select') ||
      document;
    return Array.prototype.slice
      .call(findAll(scope, '[role="option"], [class*="select__option"]'))
      .filter(shown);
  }
  function press(node) {
    ['mousedown', 'mouseup'].forEach(function (type) {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    });
    node.click();
  }
  // A page in an unfocused window moves its focus without telling its own scripts.
  function focusOn(node) {
    var told = false;
    var heard = function () {
      told = true;
    };
    node.addEventListener('focus', heard);
    if (node.focus) node.focus();
    node.removeEventListener('focus', heard);
    if (told || document.hasFocus()) return;
    node.dispatchEvent(new FocusEvent('focus'));
    node.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  }
  function openMenu(node) {
    focusOn(node);
    var control = node.closest('[class*="select__control"]');
    if (!control) return press(node);
    // Some boards open the list on the press, others on its release.
    ['mousedown', 'mouseup'].forEach(function (type) {
      control.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    });
  }
  function typeInto(node, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    fire(node, 'input');
    if (node.matches(SUGGESTED)) {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }));
    }
  }
  function closeMenu(node) {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fire(node, 'blur');
    if (node.blur) node.blur();
    if (!document.hasFocus()) {
      node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
  }
  async function menuFor(node, query) {
    if (query && node.tagName === 'INPUT') typeInto(node, query);
    var before = -1;
    var tries = query && node.matches(SUGGESTED) ? SUGGESTED_TRIES : MENU_TRIES;
    for (var attempt = 0; attempt < tries; attempt += 1) {
      await wait(MENU_WAIT_MS);
      var found = menuOptions(node);
      if (found.length > 0 && found.length === before) return found;
      before = found.length;
    }
    return menuOptions(node);
  }
  // Exactly the named option; a near match is the candidate's choice, not ours.
  function exactly(options, value) {
    var wanted = value.trim().toLowerCase();
    return options.filter(function (option) {
      return text(option).toLowerCase() === wanted;
    })[0];
  }
  async function setCombobox(node, value) {
    openMenu(node);
    var options = await menuFor(node, '');
    var match = exactly(options, value);
    if (!match && node.tagName === 'INPUT') {
      options = await menuFor(node, value);
      match = exactly(options, value);
    }
    if (!match) {
      if (node.tagName === 'INPUT') typeInto(node, '');
      closeMenu(node);
      return options.length === 0 ? 'menu_missing' : 'option_missing';
    }
    press(match);
    await wait(0);
    return 'set';
  }
  async function readMenu(node, query) {
    openMenu(node);
    var labels = (await menuFor(node, query)).slice(0, MAX_OPTIONS).map(text);
    if (query && node.tagName === 'INPUT') typeInto(node, '');
    closeMenu(node);
    await wait(0);
    return labels.filter(Boolean).map(function (label) {
      return { value: label, label: label };
    });
  }
  // ARG.requests: [{ key, query }]. Reading a list picks nothing in it.
  function options() {
    var form = findForm();
    if (!form) return { state: 'form_missing' };
    var job = { done: false, results: {} };
    window.__oqAtsJob = job;
    (async function () {
      for (var i = 0; i < ARG.requests.length; i += 1) {
        var request = ARG.requests[i];
        var node = nodeFor(form, request.key);
        try {
          job.results[request.key] =
            node && kindOf(node) === 'combobox' ? await readMenu(node, request.query || '') : [];
        } catch (_) {
          job.results[request.key] = [];
        }
      }
      job.done = true;
    })();
    return { state: 'started' };
  }
  function setChecks(form, node, value) {
    var wanted = value.split('\n').filter(Boolean);
    var list = choices(checksOf(form, node));
    var known = wanted.every(function (item) {
      return list.some(function (choice) {
        return choice.value === item || choice.label === item;
      });
    });
    if (!known) return 'option_missing';
    list.forEach(function (choice) {
      var on = wanted.indexOf(choice.value) >= 0 || wanted.indexOf(choice.label) >= 0;
      if (choice.node.checked !== on) choice.node.click();
    });
    return 'set';
  }
  function setYesNo(node, value) {
    var button = yesNoButtons(node).filter(function (candidate) {
      return text(candidate) === value;
    })[0];
    if (!button) return 'option_missing';
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return 'set';
  }
  async function setOne(form, entry) {
    var node = nodeFor(form, entry.key);
    if (!node) return 'field_missing';
    var kind = fieldKind(form, node);
    if (kind === 'checkbox_group') return setChecks(form, node, entry.value);
    if (kind === 'radio' && yesNoOf(node)) return setYesNo(node, entry.value);
    if (kind === 'file' && entry.file && profile().uploaded) {
      return setUpload(form, node, entry.file);
    }
    if (kind === 'file') return entry.file ? setFile(node, entry.file) : 'file_missing';
    if (kind === 'checkbox') {
      if (node.checked !== (entry.value === 'true')) node.click();
      return 'set';
    }
    if (kind === 'radio') {
      var choice = choices(radios(form, node.name)).filter(function (candidate) {
        return candidate.value === entry.value || candidate.label === entry.value;
      })[0];
      var radio = choice && choice.node;
      if (!radio) return 'option_missing';
      if (!radio.checked) radio.click();
      return 'set';
    }
    if (kind === 'select') return setSelect(node, entry.value);
    if (kind === 'combobox') return setCombobox(node, entry.value);
    setText(node, entry.value);
    return 'set';
  }
  // Files the board took away from their fields: it shows the name in the field's place.
  function heldFiles() {
    window.__oqAtsHeld = window.__oqAtsHeld || {};
    return window.__oqAtsHeld;
  }
  function placesOf(node) {
    var places = [];
    for (var at = node; at && places.length < HELD_LEVELS;) {
      at = at.parentNode || at.host;
      if (!at || at === document.body || at.tagName === 'FORM') break;
      if (at.nodeType === 1) places.push(at);
    }
    return places;
  }
  function shows(place, name) {
    if (place.textContent.indexOf(name) >= 0) return true;
    if (!profile().deep) return false;
    return [place].concat(Array.prototype.slice.call(findAll(place, '*'))).some(function (node) {
      return node.shadowRoot && node.shadowRoot.textContent.indexOf(name) >= 0;
    });
  }
  function isHeld(key) {
    var held = heldFiles()[key];
    return Boolean(
      held &&
      held.places.some(function (place) {
        return (
          place.isConnected &&
          shows(place, held.name) &&
          !place.querySelector('[role="progressbar"], [aria-busy="true"]')
        );
      }),
    );
  }
  async function settledFile(form, entry, places, result) {
    if (profile().uploaded || ['set', 'file_not_attached'].indexOf(result) < 0) return result;
    var value = entry.file.name + ':' + atob(entry.file.base64).length;
    if (places.length > 0) {
      heldFiles()[entry.key] = { name: entry.file.name, value: value, places: places };
    }
    var kept = 0;
    var deadline = Date.now() + HELD_LIMIT_MS;
    while (Date.now() < deadline) {
      var node = nodeFor(form, entry.key);
      kept = node && kindOf(node) === 'file' && valueOf(form, node) === value ? kept + 1 : 0;
      if (kept > 5 || (kept === 0 && isHeld(entry.key))) return 'set';
      await wait(HELD_WAIT_MS);
    }
    delete heldFiles()[entry.key];
    return 'file_not_attached';
  }
  async function setEntry(form, entry) {
    var node = entry.file ? nodeFor(form, entry.key) : null;
    var held = entry.file && !node && isHeld(entry.key) && heldFiles()[entry.key];
    if (held) {
      var same = held.value === entry.file.name + ':' + atob(entry.file.base64).length;
      return same ? 'set' : 'file_not_attached';
    }
    var places = node ? placesOf(node) : [];
    var result = await setOne(form, entry);
    return node && kindOf(node) === 'file' ? settledFile(form, entry, places, result) : result;
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
          job.results[entry.key] = await setEntry(form, entry);
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

  function invalidNodes(form) {
    return Array.prototype.slice.call(findAll(form, '[aria-invalid="true"]'));
  }
  function keysOf(form, nodes) {
    return nodes
      .map(function (node) {
        return keyOf(node, fieldKind(form, node));
      })
      .filter(Boolean);
  }
  function invalidKeys(form) {
    return keysOf(form, invalidNodes(form).filter(shown));
  }
  // The page may have changed its own address since the app last looked.
  function inPlace() {
    var path = ARG && ARG.path ? ARG.path.replace(/\/+$/, '') : '';
    return Boolean(
      path &&
      ARG.hosts.indexOf(location.hostname) >= 0 &&
      location.protocol === 'https:' &&
      (location.pathname === path || location.pathname.indexOf(path + '/') === 0),
    );
  }
  // Moves to the next page of the form; never the button that sends it.
  function next() {
    if (!inPlace()) return { state: 'off_target' };
    var form = findForm();
    if (!form) return { state: 'form_missing' };
    if (captcha()) return { state: 'captcha' };
    var buttons = nextButtons(form);
    if (buttons.length !== 1) return { state: 'next_ambiguous', count: buttons.length };
    if (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') {
      return { state: 'next_disabled' };
    }
    var from = signature(form);
    buttons[0].click();
    return { state: 'clicked', signature: from };
  }
  function moved() {
    var form = findForm();
    if (captcha()) return { state: 'captcha' };
    if (!form) return { state: 'pending' };
    var now = read();
    if (now.signature && now.signature !== ARG.signature) return { state: 'moved', form: now };
    var keys = invalidKeys(form);
    return keys.length > 0 ? { state: 'invalid', keys: keys } : { state: 'pending' };
  }

  function submit() {
    if (!inPlace()) return { state: 'off_target' };
    if (window.__oqAtsSubmitted) return { state: 'already_submitted' };
    var form = findForm();
    if (!form) return { state: 'form_missing' };
    if (captcha()) return { state: 'captcha' };
    // The board checks that a person sends the form: the last press is the candidate's.
    if (profile().byHand) return { state: 'captcha' };
    var buttons = submitButtons(form);
    // A page that still offers «Next» is not the last one.
    if (nextButtons(form).length > 0) return { state: 'submit_ambiguous', count: buttons.length };
    if (buttons.length !== 1) return { state: 'submit_ambiguous', count: buttons.length };
    if (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') {
      return { state: 'submit_disabled' };
    }
    var marked = keysOf(form, invalidNodes(form));
    window.__oqAtsSubmitted = true;
    buttons[0].click();
    return { state: 'clicked', invalidBefore: marked };
  }
  // BambooHR thanks on the vacancy's own address, in place of the form.
  function thanked(form) {
    if (form || !ARG || !ARG.thanksPath) return false;
    if (location.pathname.replace(/\/+$/, '') !== ARG.thanksPath) return false;
    var heads = Array.prototype.slice.call(document.querySelectorAll('h2')).filter(shown);
    return heads.some(function (head) {
      var said = head.nextElementSibling;
      return (
        text(head) === 'Thank You' &&
        Boolean(said) &&
        shown(said) &&
        text(said) === 'Your application was submitted successfully'
      );
    });
  }
  function outcome() {
    var confirmPath = ARG && ARG.confirmationPath;
    var here = location.pathname.replace(/\/+$/, '');
    if (confirmPath && here === confirmPath) return { state: 'confirmed', path: location.pathname };
    var form = findForm();
    if (thanked(form)) return { state: 'confirmed', path: location.pathname };
    if (captcha()) return { state: 'captcha' };
    if (form) {
      // A mark older than the press is not the board's answer to it.
      var before = (ARG && ARG.invalidBefore) || [];
      var invalid = keysOf(form, invalidNodes(form)).filter(function (key) {
        return before.indexOf(key) < 0;
      });
      if (invalid.length > 0) return { state: 'invalid', keys: invalid };
    }
    return { state: 'pending' };
  }

  var ops = {
    read: read,
    snapshot: snapshot,
    fill: fill,
    job: job,
    options: options,
    next: next,
    moved: moved,
    submit: submit,
    outcome: outcome,
  };
  try {
    return JSON.stringify(ops[OP] ? ops[OP]() : { state: 'unknown_op' });
  } catch (_) {
    return JSON.stringify({ state: 'script_failed' });
  }
})();
