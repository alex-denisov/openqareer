/** Read only: the open page as HTML, without scripts and embedded data. */
(function () {
  var clean = function (node) {
    var copy = node.cloneNode(true);
    var drop = copy.querySelectorAll(
      'script,style,code,link,meta,noscript,iframe,input[type="hidden"]',
    );
    for (var i = 0; i < drop.length; i += 1) drop[i].remove();
    return copy;
  };
  var html = [clean(document.documentElement).outerHTML];
  var walk = function (root) {
    Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
      if (!el.shadowRoot) return;
      var box = document.createElement('div');
      Array.prototype.forEach.call(el.shadowRoot.childNodes, function (child) {
        box.appendChild(child.cloneNode(true));
      });
      html.push('<!-- shadow ' + el.tagName.toLowerCase() + ' -->' + clean(box).innerHTML);
      walk(el.shadowRoot);
    });
  };
  walk(document);
  return html.join('\n');
})();
