/* B569: catalog search box. Suggestions come from /vacancies/search-index.json
 * (real cities and roles with counts). City: from the first letter, Moscow and
 * Saint Petersburg first; role: from the third letter, with the vacancy count.
 * Arrows, Enter and Escape work; markup follows the ARIA combobox pattern. */
(function () {
  var form = document.querySelector('[data-cat-search]');
  if (!form) return;
  var TOP = ['moscow', 'saint-petersburg'];
  var data = null;
  var loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = fetch('/vacancies/search-index.json')
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          data = d;
          return d;
        })
        .catch(function () {
          data = { cities: [], roles: [] };
          return data;
        });
    }
    return loading;
  }
  function field(name) {
    var input = form.querySelector('[data-cat-' + name + ']');
    return {
      input: input,
      list: document.getElementById(input.getAttribute('aria-controls')),
      slug: input.getAttribute('data-slug') || '',
    };
  }
  function build(kind, q) {
    var all = kind === 'city' ? data.cities : data.roles;
    var low = q.toLowerCase();
    if (kind === 'city') {
      var hit = all.filter(function (c) {
        return !low || c[1].toLowerCase().indexOf(low) === 0;
      });
      var top = TOP.map(function (s) {
        return hit.filter(function (c) {
          return c[0] === s;
        })[0];
      }).filter(Boolean);
      var rest = hit
        .filter(function (c) {
          return TOP.indexOf(c[0]) < 0;
        })
        .slice(0, 40);
      if (!top.length && !rest.length) return [{ hint: 'Такого города нет в каталоге' }];
      return top.concat(top.length && rest.length ? ['sep'] : [], rest);
    }
    if (low.length < 3) return null;
    var m = all.filter(function (r) {
      return r[1].toLowerCase().indexOf(low) >= 0;
    });
    m.sort(function (a, b) {
      return (
        (a[1].toLowerCase().indexOf(low) === 0 ? 0 : 1) -
          (b[1].toLowerCase().indexOf(low) === 0 ? 0 : 1) || b[2] - a[2]
      );
    });
    return m.length ? m.slice(0, 8) : [{ hint: 'Нет такой должности в каталоге' }];
  }
  function setup(kind) {
    var f = field(kind),
      input = f.input,
      list = f.list,
      active = -1;
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function options() {
      return [].slice.call(list.querySelectorAll('[role=option]'));
    }
    function mark(i) {
      var o = options();
      o.forEach(function (x, k) {
        x.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      active = i;
      if (o[i]) {
        input.setAttribute('aria-activedescendant', o[i].id);
        o[i].scrollIntoView({ block: 'nearest' });
      }
    }
    function render() {
      load().then(function () {
        var items = build(kind, input.value.trim());
        if (!items) {
          close();
          return;
        }
        list.textContent = '';
        items.forEach(function (it, k) {
          var li = document.createElement('li');
          if (it === 'sep') {
            li.className = 'sep';
            li.setAttribute('role', 'separator');
          } else if (it.hint) {
            li.className = 'hint';
            li.textContent = it.hint;
          } else {
            li.setAttribute('role', 'option');
            li.id = list.id + '-' + k;
            li.setAttribute('aria-selected', 'false');
            li.setAttribute('data-slug', it[0]);
            li.setAttribute('data-label', it[1]);
            li.appendChild(document.createTextNode(it[1]));
            var n = document.createElement('span');
            n.textContent = it[2].toLocaleString('ru-RU');
            li.appendChild(n);
          }
          list.appendChild(li);
        });
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
      });
    }
    function pick(li) {
      input.value = li.getAttribute('data-label');
      input.setAttribute('data-slug', li.getAttribute('data-slug'));
      close();
    }
    input.addEventListener('input', function () {
      input.setAttribute('data-slug', '');
      render();
    });
    input.addEventListener('focus', function () {
      load();
      input.select();
    });
    input.addEventListener('keydown', function (e) {
      var o = options();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) render();
        else mark(Math.min(active + 1, o.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        mark(Math.max(active - 1, 0));
      } else if (e.key === 'Enter' && active >= 0 && !list.hidden) {
        e.preventDefault();
        pick(o[active]);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest ? e.target.closest('[role=option]') : null;
      if (li) {
        e.preventDefault();
        pick(li);
      }
    });
    input.addEventListener('blur', function () {
      setTimeout(close, 120);
    });
    return f;
  }
  var role = setup('role');
  var city = setup('city');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    load().then(function () {
      function slugOf(f, all) {
        var typed = f.input.value.trim().toLowerCase();
        if (!typed) return '';
        if (f.input.getAttribute('data-slug')) return f.input.getAttribute('data-slug');
        var exact = all.filter(function (x) {
          return x[1].toLowerCase() === typed;
        })[0];
        return exact ? exact[0] : '';
      }
      var p = slugOf(city, data.cities),
        r = slugOf(role, data.roles);
      if (r && !p) {
        var known = data.roles.filter(function (x) {
          return x[0] === r;
        })[0];
        p = known && known[3] ? known[3] : '';
      }
      var path = '/vacancies' + (p ? '/' + p : '') + (r && p ? '/' + r : '');
      window.location.assign(path);
    });
  });
})();

/* B569: long blocks fold to their first rows. data-fold="N" shows N rows (the
 * header marked .lv-keep stays); data-fold-m folds on phones only. Without this
 * script every row is in the page, so crawlers and readers without scripts see
 * the whole list. */
(function () {
  var phone = window.matchMedia && window.matchMedia('(max-width:760px)').matches;
  [].forEach.call(document.querySelectorAll('[data-fold],[data-fold-m]'), function (box) {
    var both = box.hasAttribute('data-fold') && box.hasAttribute('data-fold-m');
    var onlyPhone = !both && box.hasAttribute('data-fold-m');
    var attr = both
      ? phone
        ? 'data-fold-m'
        : 'data-fold'
      : onlyPhone
        ? 'data-fold-m'
        : 'data-fold';
    var n = +box.getAttribute(attr);
    var items = [].slice.call(box.children).filter(function (c) {
      return !c.classList.contains('lv-keep');
    });
    if (items.length <= n) return;
    var cls = onlyPhone ? 'fx-m fx' : 'fx';
    items.slice(n).forEach(function (c) {
      c.className += ' ' + cls;
    });
    var label = box.getAttribute('data-fold-label') || 'Показать все: ' + items.length;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ps-btn lv-fold-more' + (onlyPhone ? ' m-only' : '');
    b.textContent = label;
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') !== 'true';
      items.slice(n).forEach(function (c) {
        c.classList.toggle('fx', !open);
      });
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Свернуть' : label;
    });
    var anchor = box.closest('.lv-card') || box;
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
  });
})();
