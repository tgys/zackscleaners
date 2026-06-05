/**
 * Country-code fields: native <select> menus are often drawn full-viewport on Linux/GTK.
 * Custom panel anchored under the trigger via fixed + getBoundingClientRect (immune to scroll/layout quirks).
 */
(function () {
  function shortenLabel(text, code) {
    var trimmed = String(text || "").trim();
    if (code === "+1") return "+1 — US, Canada & NANP territories";
    var m = trimmed.match(/^\+?\d+\s*\u2014\s*(.+)$/) || trimmed.match(/^\+?\d+\s*[\u2013-]\s*(.+)$/);
    if (!m) return trimmed || code;
    var tail = m[1].trim();
    var chunk = tail.split(/\s*[·•]\s*/)[0].trim();
    if (!chunk) chunk = tail.slice(0, 54);
    if (chunk.length > 54) chunk = chunk.slice(0, 51) + "\u2026";
    return code + " \u2014 " + chunk;
  }

  function shortenOption(option) {
    var code = option.value;
    if (!code || code.charAt(0) !== "+") return;
    option.textContent = shortenLabel(option.textContent, code);
  }

  function enhance(widget) {
    var sel = widget.querySelector("select.auth-form-phone-prefix-native");
    var btn = widget.querySelector(".auth-form-phone-prefix-widget__trigger");
    var panel = widget.querySelector(".auth-form-phone-prefix-widget__dropdown");
    if (!sel || !btn || !panel) return;

    Array.prototype.forEach.call(sel.querySelectorAll("option[value]"), shortenOption);

    function rebuildList() {
      panel.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (opt) {
        if (!opt.value) return;
        var row = document.createElement("div");
        row.className = "auth-form-phone-prefix-widget__option";
        row.setAttribute("role", "option");
        row.setAttribute("data-value", opt.value);
        row.textContent = opt.textContent;
        panel.appendChild(row);
      });
    }

    function syncTriggerFromSelect() {
      var opt = sel.options[sel.selectedIndex];
      btn.textContent = opt ? opt.textContent : "";
    }

    function placePanelUnderTrigger() {
      var r = btn.getBoundingClientRect();
      var gap = 4;
      panel.style.left = Math.round(r.left) + "px";
      panel.style.top = Math.round(r.bottom + gap) + "px";
      panel.style.width = Math.round(r.width) + "px";
    }

    function clearPanelGeometry() {
      panel.style.left = "";
      panel.style.top = "";
      panel.style.width = "";
    }

    function scrollSelectedIntoPanelView() {
      var selectedVal = sel.value;
      var rows = panel.querySelectorAll('[role="option"]');
      var matched = null;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var match = row.getAttribute("data-value") === selectedVal;
        row.setAttribute("aria-selected", match ? "true" : "false");
        if (match) matched = row;
      }
      panel.scrollTop = 0;
      if (!matched) return;
      var ph = panel.clientHeight;
      var ry = matched.offsetTop;
      var rh = matched.offsetHeight;
      var center = ry - ph / 2 + rh / 2;
      panel.scrollTop = Math.max(0, Math.min(center, panel.scrollHeight - ph));
    }

    function closePanel() {
      if (panel.hidden) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      clearPanelGeometry();
    }

    function openPanel() {
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      placePanelUnderTrigger();
      scrollSelectedIntoPanelView();
    }

    rebuildList();
    syncTriggerFromSelect();

    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (panel.hidden) openPanel();
      else closePanel();
    });

    panel.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var row = ev.target && ev.target.closest ? ev.target.closest('[role="option"]') : null;
      if (!row || !panel.contains(row)) return;
      sel.value = row.getAttribute("data-value");
      try {
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        /* IE */
      }
      syncTriggerFromSelect();
      closePanel();
      btn.focus();
    });

    document.addEventListener(
      "click",
      function (ev) {
        if (!widget.contains(ev.target)) closePanel();
      },
      false,
    );

    document.addEventListener(
      "scroll",
      function () {
        if (!panel.hidden) placePanelUnderTrigger();
      },
      true,
    );

    window.addEventListener("resize", function () {
      if (!panel.hidden) placePanelUnderTrigger();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (panel.hidden) return;
      closePanel();
      btn.focus();
    });
  }

  var widgets = document.querySelectorAll(".auth-form-phone-prefix-widget");
  for (var w = 0; w < widgets.length; w++) {
    enhance(widgets[w]);
  }
})();
