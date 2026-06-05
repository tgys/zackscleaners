    }, 450);      '<p class="messages-reply__hint">Uses your outgoing mail settings. A staff signature from Settings (name, email, phone, address) is added automatically.</p>' +"use strict";

(function () {
  var loadingEl = document.getElementById("messages-loading");
  var layoutEl = document.getElementById("messages-layout");
  var tabInbox = document.getElementById("messages-tab-inbox");
  var tabSent = document.getElementById("messages-tab-sent");
  var sidebarEl = document.getElementById("messages-sidebar-list");
  var detailEl = document.getElementById("messages-detail-inner");
  /** Set after inbox loads; used in reply form + detail panes. */
  var feedMeta = { noreplyMailbox: "", infoMailbox: "" };
  var currentTab = "inbox";
  /** Last selected inbox row ({ kind, id }) — preserved on real-time refresh. */
  var currentInboxSelection = null;
  var currentSentSelection = null;
  var wsInboxDebounceTimer = null;
  var wsSentDebounceTimer = null;
  var adminWs = null;
  var wsReconnectMs = 3000;
  var visibilityRefetchTimer = null;
  /** When unchanged, skip replacing sidebar DOM (avoids repaint flicker on WS / visibility refresh). */
  var lastInboxEntriesSig = "";
  var lastSentEntriesSig = "";
  /** Reuse row nodes so WS / visibility refresh does not rebuild the entire sidebar (reduces flicker). */
  var inboxRowCache = new Map();
  var sentRowCache = new Map();

  function clearInboxRowCache() {
    inboxRowCache.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    inboxRowCache.clear();
  }

  function clearSentRowCache() {
    sentRowCache.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    sentRowCache.clear();
  }

  /** Drop loading / empty paragraphs so list rows can coexist only with .messages-sidebar__item nodes. */
  function removeSidebarNonItemChildren() {
    if (!sidebarEl) return;
    for (var i = sidebarEl.children.length - 1; i >= 0; i--) {
      var ch = sidebarEl.children[i];
      if (!ch.classList.contains("messages-sidebar__item")) {
        sidebarEl.removeChild(ch);
      }
    }
  }

  function patchInboxRowEl(item, row) {
    var kindLabel =
      row.kind === "recruitment" ? "Job" : row.kind === "info" ? "Email" : "Contact";
    var tagTitle = "Mailbox: " + row.inboxTag;
    var sel = item.querySelector(".messages-sidebar__select");
    sel.setAttribute("data-entry-kind", row.kind);
    sel.setAttribute("data-entry-id", row.id);
    item.querySelector(".messages-sidebar__kind").textContent = kindLabel;
    var ch = item.querySelector(".messages-sidebar__channel");
    ch.title = tagTitle;
    ch.textContent = row.inboxTag != null ? String(row.inboxTag) : "";
    var titleEl = item.querySelector(".messages-sidebar__title");
    if (row.kind === "info") {
      titleEl.innerHTML =
        '<span class="messages-sidebar__subject-prefix">subject:</span> ' +
        esc(row.lineTitle != null ? row.lineTitle : "");
    } else {
      titleEl.textContent = row.lineTitle != null ? String(row.lineTitle) : "";
    }
    item.querySelector(".messages-sidebar__meta").textContent =
      fmtWhen(row.created_at) +
      " · " +
      (row.lineName != null ? String(row.lineName) : "");
    var del = item.querySelector(".messages-sidebar__delete");
    del.setAttribute("data-delete-kind", row.kind);
    del.setAttribute("data-delete-id", row.id);
  }

  function createInboxRowEl(row) {
    var wrap = document.createElement("div");
    wrap.className = "messages-sidebar__item";
    var sel = document.createElement("button");
    sel.type = "button";
    sel.className = "messages-sidebar__select";
    var kindSpan = document.createElement("span");
    kindSpan.className = "messages-sidebar__kind";
    var chSpan = document.createElement("span");
    chSpan.className = "messages-sidebar__channel";
    var titleSpan = document.createElement("span");
    titleSpan.className = "messages-sidebar__title";
    var metaSpan = document.createElement("span");
    metaSpan.className = "messages-sidebar__meta";
    sel.appendChild(kindSpan);
    sel.appendChild(chSpan);
    sel.appendChild(titleSpan);
    sel.appendChild(metaSpan);
    var del = document.createElement("button");
    del.type = "button";
    del.className = "messages-sidebar__delete";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete message");
    del.textContent = "×";
    wrap.appendChild(sel);
    wrap.appendChild(del);
    patchInboxRowEl(wrap, row);
    return wrap;
  }

  function mergeInboxSidebar(merged) {
    if (!sidebarEl) return;
    removeSidebarNonItemChildren();
    var wantKeys = new Set();
    merged.forEach(function (row) {
      wantKeys.add(String(row.kind) + ":" + String(row.id));
    });
    var staleKeys = [];
    inboxRowCache.forEach(function (_el, key) {
      if (!wantKeys.has(key)) staleKeys.push(key);
    });
    staleKeys.forEach(function (key) {
      var el = inboxRowCache.get(key);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      inboxRowCache.delete(key);
    });
    merged.forEach(function (row) {
      var key = String(row.kind) + ":" + String(row.id);
      var item = inboxRowCache.get(key);
      if (!item) {
        item = createInboxRowEl(row);
        inboxRowCache.set(key, item);
      } else {
        patchInboxRowEl(item, row);
      }
      sidebarEl.appendChild(item);
    });
  }

  function patchSentRowEl(item, row) {
    var fromLbl = sentFromLabel(row.reply_from);
    var sel = item.querySelector(".messages-sidebar__select");
    sel.setAttribute("data-sent-id", row.id);
    item.querySelector(".messages-sidebar__channel").title = "From: " + fromLbl;
    item.querySelector(".messages-sidebar__channel").textContent = fromLbl;
    item.querySelector(".messages-sidebar__title").textContent =
      row.subject != null ? String(row.subject) : "";
    item.querySelector(".messages-sidebar__meta").textContent =
      fmtWhen(row.created_at) + " → " + (row.to_email != null ? String(row.to_email) : "");
    item.querySelector(".messages-sidebar__delete").setAttribute("data-sent-delete-id", row.id);
  }

  function createSentRowEl(row) {
    var wrap = document.createElement("div");
    wrap.className = "messages-sidebar__item";
    var sel = document.createElement("button");
    sel.type = "button";
    sel.className = "messages-sidebar__select";
    var kindSpan = document.createElement("span");
    kindSpan.className = "messages-sidebar__kind";
    kindSpan.textContent = "Sent";
    var chSpan = document.createElement("span");
    chSpan.className = "messages-sidebar__channel";
    var titleSpan = document.createElement("span");
    titleSpan.className = "messages-sidebar__title";
    var metaSpan = document.createElement("span");
    metaSpan.className = "messages-sidebar__meta";
    sel.appendChild(kindSpan);
    sel.appendChild(chSpan);
    sel.appendChild(titleSpan);
    sel.appendChild(metaSpan);
    var del = document.createElement("button");
    del.type = "button";
    del.className = "messages-sidebar__delete";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete sent log");
    del.textContent = "×";
    wrap.appendChild(sel);
    wrap.appendChild(del);
    patchSentRowEl(wrap, row);
    return wrap;
  }

  function mergeSentSidebar(rows) {
    if (!sidebarEl) return;
    removeSidebarNonItemChildren();
    var wantIds = new Set();
    rows.forEach(function (row) {
      wantIds.add(String(row.id));
    });
    var staleIds = [];
    sentRowCache.forEach(function (_el, id) {
      if (!wantIds.has(id)) staleIds.push(id);
    });
    staleIds.forEach(function (id) {
      var el = sentRowCache.get(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      sentRowCache.delete(id);
    });
    rows.forEach(function (row) {
      var id = String(row.id);
      var item = sentRowCache.get(id);
      if (!item) {
        item = createSentRowEl(row);
        sentRowCache.set(id, item);
      } else {
        patchSentRowEl(item, row);
      }
      sidebarEl.appendChild(item);
    });
  }

  function attachSidebarDelegatedClick() {
    if (!sidebarEl || sidebarEl.dataset.delegatedClick === "1") return;
    sidebarEl.dataset.delegatedClick = "1";
    sidebarEl.addEventListener("click", function (ev) {
      var t = ev.target;
      var delInbox = t.closest(".messages-sidebar__delete[data-delete-kind]");
      if (delInbox && currentTab === "inbox") {
        ev.stopPropagation();
        deleteInboxEntry(
          delInbox.getAttribute("data-delete-kind"),
          delInbox.getAttribute("data-delete-id"),
          delInbox,
        );
        return;
      }
      var delSent = t.closest(".messages-sidebar__delete[data-sent-delete-id]");
      if (delSent && currentTab === "sent") {
        ev.stopPropagation();
        deleteSentEntry(delSent.getAttribute("data-sent-delete-id"), delSent);
        return;
      }
      var selInbox = t.closest(".messages-sidebar__select[data-entry-id]");
      if (selInbox && currentTab === "inbox") {
        showDetail(
          selInbox.getAttribute("data-entry-kind"),
          selInbox.getAttribute("data-entry-id"),
          selInbox,
        );
        return;
      }
      var selSent = t.closest(".messages-sidebar__select[data-sent-id]");
      if (selSent && currentTab === "sent") {
        showSentDetail(selSent.getAttribute("data-sent-id"), selSent);
      }
    });
  }

  function inboxEntriesSignature(entries) {
    if (!entries || entries.length === 0) return "";
    return entries
      .map(function (row) {
        return [
          row.kind,
          row.id,
          row.created_at != null ? String(row.created_at) : "",
          row.lineTitle != null ? String(row.lineTitle) : "",
          row.lineName != null ? String(row.lineName) : "",
          row.inboxTag != null ? String(row.inboxTag) : "",
        ].join("\x1f");
      })
      .join("\x1e");
  }

  function sentEntriesSignature(rows) {
    if (!rows || rows.length === 0) return "";
    return rows
      .map(function (row) {
        return [
          row.id,
          row.subject != null ? String(row.subject) : "",
          row.to_email != null ? String(row.to_email) : "",
          row.reply_from != null ? String(row.reply_from) : "",
          row.created_at != null ? String(row.created_at) : "",
        ].join("\x1f");
      })
      .join("\x1e");
  }

  function scheduleWsInboxRefresh() {
    if (wsInboxDebounceTimer) clearTimeout(wsInboxDebounceTimer);
    wsInboxDebounceTimer = setTimeout(function () {
      wsInboxDebounceTimer = null;
      if (currentTab !== "inbox") return;
      loadInboxPanelInner(true);
    }, 450);
  }

  function scheduleWsSentRefresh() {
    if (wsSentDebounceTimer) clearTimeout(wsSentDebounceTimer);
    wsSentDebounceTimer = setTimeout(function () {
      wsSentDebounceTimer = null;
      if (currentTab !== "sent") return;
      loadSentPanelInner(true);
    }, 450);
  }

  function connectAdminMessagesWs() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/api/admin/messages-ws";
    try {
      adminWs = new WebSocket(url);
    } catch (e) {
      setTimeout(connectAdminMessagesWs, wsReconnectMs);
      return;
    }
    adminWs.onopen = function () {
      wsReconnectMs = 3000;
      if (currentTab === "inbox") scheduleWsInboxRefresh();
      else if (currentTab === "sent") scheduleWsSentRefresh();
    };
    adminWs.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "inbox_refresh") scheduleWsInboxRefresh();
        else if (msg.type === "sent_refresh") scheduleWsSentRefresh();
      } catch (e) {}
    };
    adminWs.onclose = function () {
      adminWs = null;
      setTimeout(connectAdminMessagesWs, wsReconnectMs);
      wsReconnectMs = Math.min(Math.floor(wsReconnectMs * 1.5), 30000);
    };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (e) {
      return iso;
    }
  }

  function mailboxDisplay(inboxTagRaw) {
    var raw = inboxTagRaw || "noreply";
    if (raw === "noreply" && feedMeta.noreplyMailbox) {
      return feedMeta.noreplyMailbox;
    }
    return raw;
  }

  function sentFromLabel(replyFrom) {
    if (replyFrom === "info" && feedMeta.infoMailbox) {
      return feedMeta.infoMailbox;
    }
    if (feedMeta.noreplyMailbox) {
      return feedMeta.noreplyMailbox;
    }
    return replyFrom === "info" ? "info" : "noreply";
  }

  var REPLY_MAX = 20000;

  function replyFormHtml(defaultMailbox) {
    defaultMailbox = defaultMailbox === "info" ? "info" : "noreply";
    var n = feedMeta.noreplyMailbox || "noreply";
    var i = feedMeta.infoMailbox || "info";
    return (
      '<div class="messages-reply">' +
      '<p class="messages-reply__label">Reply by email</p>' +
      '<p class="messages-reply__hint">Uses your outgoing mail settings. A staff signature from Settings (name, email, phone, address) is added automatically.</p>' +
      '<div class="messages-reply__from-row">' +
      '<label class="messages-reply__sublabel" for="messages-reply-from">Send from</label>' +
      '<select id="messages-reply-from" class="messages-reply__from" autocomplete="off">' +
      '<option value="noreply"' +
      (defaultMailbox === "noreply" ? " selected" : "") +
      ">No-reply (" +
      esc(n) +
      ")</option>" +
      '<option value="info"' +
      (defaultMailbox === "info" ? " selected" : "") +
      ">Info (" +
      esc(i) +
      ")</option>" +
      "</select>" +
      "</div>" +
      '<textarea class="messages-reply__textarea" rows="6" maxlength="' +
      REPLY_MAX +
      '" placeholder="Write your reply…"></textarea>' +
      '<p class="messages-reply__feedback msg-error" role="alert"></p>' +
      '<p class="messages-reply__ok msg-success" hidden></p>' +
      '<button type="button" class="btn-primary messages-reply__send">Send email</button>' +
      "</div>"
    );
  }

  function bindReplyForm(kind, id) {
    if (!detailEl) return;
    var wrap = detailEl.querySelector(".messages-reply");
    if (!wrap) return;
    var ta = wrap.querySelector(".messages-reply__textarea");
    var sendBtn = wrap.querySelector(".messages-reply__send");
    var fromSel = wrap.querySelector(".messages-reply__from");
    var errEl = wrap.querySelector(".messages-reply__feedback");
    var okEl = wrap.querySelector(".messages-reply__ok");

    sendBtn.addEventListener("click", async function () {
      errEl.textContent = "";
      errEl.classList.remove("is-visible");
      okEl.textContent = "";
      okEl.hidden = true;
      var text = ta.value.trim();
      if (!text) {
        errEl.textContent = "Enter a message before sending.";
        errEl.classList.add("is-visible");
        return;
      }
      sendBtn.disabled = true;
      var prev = sendBtn.textContent;
      sendBtn.textContent = "Sending…";
      try {
        var replyFrom = fromSel && fromSel.value === "info" ? "info" : "noreply";
        var r = await fetch("/api/admin/inbox-reply", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: kind,
            id: id,
            body: text,
            replyFrom: replyFrom,
          }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          errEl.textContent = data.error || "Could not send.";
          errEl.classList.add("is-visible");
          return;
        }
        okEl.textContent = "Email sent.";
        okEl.hidden = false;
        ta.value = "";
      } catch (e) {
        errEl.textContent = "Network error.";
        errEl.classList.add("is-visible");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = prev || "Send email";
      }
    });
  }

  async function loadMe() {
    var r = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!r.ok) return null;
    return r.json();
  }

  function showForbidden() {
    if (loadingEl) loadingEl.textContent = "You must be signed in as an administrator.";
    if (layoutEl) layoutEl.hidden = true;
  }

  function setActive(btn, active) {
    var buttons = sidebarEl
      ? sidebarEl.querySelectorAll("button.messages-sidebar__select[data-entry-id]")
      : [];
    buttons.forEach(function (b) {
      b.classList.toggle("is-active", b === btn && active);
    });
  }

  function setActiveSent(btn, active) {
    var buttons = sidebarEl
      ? sidebarEl.querySelectorAll("button.messages-sidebar__select[data-sent-id]")
      : [];
    buttons.forEach(function (b) {
      b.classList.toggle("is-active", b === btn && active);
    });
  }

  function setDeleteNotice(msg) {
    var el = document.getElementById("messages-delete-notice");
    if (!el) return;
    var text = msg == null ? "" : String(msg).trim();
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  async function deleteInboxEntry(kind, id, deleteBtn) {
    setDeleteNotice("");
    var prevDisabled = deleteBtn ? deleteBtn.disabled : false;
    if (deleteBtn) deleteBtn.disabled = true;
    try {
      var r = await fetch(
        "/api/admin/inbox-messages/" +
          encodeURIComponent(kind) +
          "/" +
          encodeURIComponent(id),
        { method: "DELETE", credentials: "same-origin" },
      );
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) {
        setDeleteNotice(data.error || "Could not delete.");
        return;
      }
      var wasSel =
        currentInboxSelection &&
        String(currentInboxSelection.kind) === String(kind) &&
        String(currentInboxSelection.id) === String(id);
      if (wasSel) currentInboxSelection = null;
      lastInboxEntriesSig = "";
      await loadInboxPanelInner(true);
    } catch (e) {
      setDeleteNotice("Network error.");
    } finally {
      if (deleteBtn) deleteBtn.disabled = prevDisabled;
    }
  }

  async function deleteSentEntry(id, deleteBtn) {
    setDeleteNotice("");
    var prevDisabled = deleteBtn ? deleteBtn.disabled : false;
    if (deleteBtn) deleteBtn.disabled = true;
    try {
      var r = await fetch("/api/admin/sent-messages/" + encodeURIComponent(id), {
        method: "DELETE",
        credentials: "same-origin",
      });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) {
        setDeleteNotice(data.error || "Could not delete.");
        return;
      }
      var wasSel = currentSentSelection != null && String(currentSentSelection) === String(id);
      if (wasSel) currentSentSelection = null;
      lastSentEntriesSig = "";
      await loadSentPanelInner(true);
    } catch (e) {
      setDeleteNotice("Network error.");
    } finally {
      if (deleteBtn) deleteBtn.disabled = prevDisabled;
    }
  }

  async function prefetchFeedMeta() {
    try {
      var r1 = await fetch("/api/admin/inbox-feed", { credentials: "same-origin" });
      if (!r1.ok) return false;
      var data1 = await r1.json();
      if (data1.meta) {
        feedMeta.noreplyMailbox = data1.meta.noreplyMailbox || "";
        feedMeta.infoMailbox = data1.meta.infoMailbox || "";
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function showContactDetail(id, btn) {
    if (!detailEl) return;
    setActive(null, false);
    detailEl.innerHTML = '<p class="messages-detail__placeholder">Loading…</p>';
    try {
      var r = await fetch("/api/admin/contact-messages/" + encodeURIComponent(id), {
        credentials: "same-origin",
      });
      if (!r.ok) {
        detailEl.innerHTML =
          '<p class="messages-detail__placeholder">Could not load this message.</p>';
        setActive(null, false);
        return;
      }
      var data = await r.json();
      var m = data.message;
      detailEl.innerHTML =
        '<div class="messages-detail__scroll">' +
        '<p class="messages-detail__source">Contact form</p>' +
        "<h1>" +
        esc(m.title) +
        "</h1>" +
        '<dl class="messages-detail__fields">' +
        '<div class="messages-detail__field"><dt>From</dt><dd>' +
        esc(m.name) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Email</dt><dd>' +
        esc(m.email) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Mobile</dt><dd>' +
        esc(m.mobile) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Mailbox</dt><dd>' +
        esc(mailboxDisplay(m.inbox_tag)) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Received</dt><dd>' +
        esc(fmtWhen(m.created_at)) +
        "</dd></div>" +
        "</dl>" +
        '<div class="messages-detail__body">' +
        '<p class="messages-detail__body-label">Message</p>' +
        '<p class="messages-detail__body-text">' +
        esc(m.body) +
        "</p>" +
        "</div>" +
        "</div>" +
        replyFormHtml("noreply");
      setActive(btn, true);
      bindReplyForm("contact", id);
    } catch (e) {
      detailEl.innerHTML =
        '<p class="messages-detail__placeholder">Network error loading message.</p>';
      setActive(null, false);
    }
  }

  async function showRecruitmentDetail(id, btn) {
    if (!detailEl) return;
    setActive(null, false);
    detailEl.innerHTML = '<p class="messages-detail__placeholder">Loading…</p>';
    try {
      var r = await fetch("/api/admin/recruitment-applications/" + encodeURIComponent(id), {
        credentials: "same-origin",
      });
      if (!r.ok) {
        detailEl.innerHTML =
          '<p class="messages-detail__placeholder">Could not load this application.</p>';
        setActive(null, false);
        return;
      }
      var data = await r.json();
      var a = data.application;
      var cvHref =
        "/api/admin/recruitment-applications/" + encodeURIComponent(id) + "/cv";
      detailEl.innerHTML =
        '<div class="messages-detail__scroll">' +
        '<p class="messages-detail__source">Job application / CV</p>' +
        "<h1>" +
        esc(a.name) +
        "</h1>" +
        '<dl class="messages-detail__fields">' +
        '<div class="messages-detail__field"><dt>Email</dt><dd>' +
        esc(a.email) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Mobile</dt><dd>' +
        esc(a.mobile) +
        "</dd></div>" +
        '<div class="messages-detail__field messages-detail__field--wide"><dt>Address</dt><dd>' +
        esc(a.address) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>CV filename</dt><dd>' +
        esc(a.cv_original_name) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Mailbox</dt><dd>' +
        esc(mailboxDisplay(a.inbox_tag)) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Received</dt><dd>' +
        esc(fmtWhen(a.created_at)) +
        "</dd></div>" +
        "</dl>" +
        '<p class="messages-detail__cv-row">' +
        '<a class="btn-primary btn-primary--inline" href="' +
        esc(cvHref) +
        '">Download CV (PDF)</a>' +
        "</p>" +
        "</div>" +
        replyFormHtml("noreply");
      setActive(btn, true);
      bindReplyForm("recruitment", id);
    } catch (e) {
      detailEl.innerHTML =
        '<p class="messages-detail__placeholder">Network error loading application.</p>';
      setActive(null, false);
    }
  }

  async function showInfoInboundDetail(id, btn) {
    if (!detailEl) return;
    setActive(null, false);
    detailEl.innerHTML = '<p class="messages-detail__placeholder">Loading…</p>';
    try {
      var r = await fetch(
        "/api/admin/info-inbound-messages/" + encodeURIComponent(id),
        { credentials: "same-origin" },
      );
      if (!r.ok) {
        detailEl.innerHTML =
          '<p class="messages-detail__placeholder">Could not load this message.</p>';
        setActive(null, false);
        return;
      }
      var data = await r.json();
      var m = data.message;
      var infoSubjectRaw =
        m.subject != null && String(m.subject).trim() !== ""
          ? String(m.subject).trim()
          : "(no subject)";
      detailEl.innerHTML =
        '<div class="messages-detail__scroll">' +
        '<p class="messages-detail__source">Incoming email</p>' +
        '<h1 class="messages-detail__subject-heading">' +
        '<span class="messages-detail__subject-prefix">subject:</span> ' +
        '<span class="messages-detail__subject-text">' +
        esc(infoSubjectRaw) +
        "</span></h1>" +
        '<dl class="messages-detail__fields">' +
        '<div class="messages-detail__field"><dt>From</dt><dd>' +
        esc(m.from_name || "—") +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Email</dt><dd>' +
        esc(m.from_email) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Mailbox</dt><dd>' +
        esc(mailboxDisplay(m.inbox_tag)) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Received</dt><dd>' +
        esc(fmtWhen(m.received_at)) +
        "</dd></div>" +
        "</dl>" +
        '<div class="messages-detail__body">' +
        '<p class="messages-detail__body-label">Message</p>' +
        '<pre class="messages-detail__body-pre">' +
        esc(m.body_text) +
        "</pre>" +
        "</div>" +
        "</div>" +
        replyFormHtml("info");
      setActive(btn, true);
      bindReplyForm("info", id);
    } catch (e) {
      detailEl.innerHTML =
        '<p class="messages-detail__placeholder">Network error loading message.</p>';
      setActive(null, false);
    }
  }

  function showDetail(kind, id, btn) {
    currentInboxSelection = { kind: kind, id: String(id) };
    if (kind === "recruitment") {
      return showRecruitmentDetail(id, btn);
    }
    if (kind === "info") {
      return showInfoInboundDetail(id, btn);
    }
    return showContactDetail(id, btn);
  }

  async function loadInboxPanel() {
    return loadInboxPanelInner(false);
  }

  async function loadInboxPanelInner(preserveSelection) {
    if (!sidebarEl) return;
    attachSidebarDelegatedClick();
    if (!preserveSelection) {
      currentInboxSelection = null;
      lastInboxEntriesSig = "";
      clearInboxRowCache();
      clearSentRowCache();
      sidebarEl.innerHTML = '<p class="messages-sidebar__empty">Loading…</p>';
      if (detailEl) {
        detailEl.innerHTML = '<p class="messages-detail__placeholder">Select a message.</p>';
      }
    }

    var r1 = await fetch("/api/admin/inbox-feed", { credentials: "same-origin" });
    if (!r1.ok) {
      if (!preserveSelection) {
        clearInboxRowCache();
        sidebarEl.innerHTML =
          '<p class="messages-sidebar__empty">Could not load inbox.</p>';
      }
      return;
    }
    var data1 = await r1.json();
    if (data1.meta) {
      feedMeta.noreplyMailbox = data1.meta.noreplyMailbox || "";
      feedMeta.infoMailbox = data1.meta.infoMailbox || "";
    }
    var merged = data1.entries || [];

    if (merged.length === 0) {
      currentInboxSelection = null;
      lastInboxEntriesSig = "";
      clearInboxRowCache();
      sidebarEl.innerHTML =
        '<p class="messages-sidebar__empty">No messages yet. Form submissions and mail to your info address appear here after sync.</p>';
      if (detailEl) {
        detailEl.innerHTML =
          '<p class="messages-detail__placeholder">Nothing in the inbox.</p>';
      }
      return;
    }

    var entriesSig = inboxEntriesSignature(merged);
    if (
      preserveSelection &&
      entriesSig !== "" &&
      entriesSig === lastInboxEntriesSig &&
      currentInboxSelection
    ) {
      var hk = String(currentInboxSelection.kind);
      var hid = String(currentInboxSelection.id);
      var existingBtn = null;
      sidebarEl.querySelectorAll("button.messages-sidebar__select[data-entry-id]").forEach(function (btn) {
        if (existingBtn) return;
        if (btn.getAttribute("data-entry-kind") === hk && btn.getAttribute("data-entry-id") === hid) {
          existingBtn = btn;
        }
      });
      if (existingBtn) {
        setActive(existingBtn, true);
        return;
      }
    }
    lastInboxEntriesSig = entriesSig;

    mergeInboxSidebar(merged);

    var pickBtn = null;
    if (preserveSelection && currentInboxSelection) {
      var selK = String(currentInboxSelection.kind);
      var selId = String(currentInboxSelection.id);
      sidebarEl.querySelectorAll("button.messages-sidebar__select[data-entry-id]").forEach(function (btn) {
        if (pickBtn) return;
        if (
          btn.getAttribute("data-entry-kind") === selK &&
          btn.getAttribute("data-entry-id") === selId
        ) {
          pickBtn = btn;
        }
      });
    }

    /* Background refresh (WS / visibility): keep detail pane stable if the same row still exists. */
    if (
      preserveSelection &&
      pickBtn &&
      currentInboxSelection &&
      pickBtn.getAttribute("data-entry-kind") === String(currentInboxSelection.kind) &&
      pickBtn.getAttribute("data-entry-id") === String(currentInboxSelection.id)
    ) {
      setActive(pickBtn, true);
      return;
    }

    var useBtn = pickBtn || sidebarEl.querySelector("button.messages-sidebar__select[data-entry-id]");
    if (useBtn) {
      showDetail(
        useBtn.getAttribute("data-entry-kind"),
        useBtn.getAttribute("data-entry-id"),
        useBtn,
      );
    }
  }

  function relatedKindLabel(k) {
    if (k === "recruitment") return "Job application";
    if (k === "info") return "Incoming email thread";
    return "Contact form";
  }

  async function showSentDetail(id, btn) {
    if (!detailEl) return;
    setActiveSent(null, false);
    detailEl.innerHTML = '<p class="messages-detail__placeholder">Loading…</p>';
    try {
      var r = await fetch("/api/admin/sent-messages/" + encodeURIComponent(id), {
        credentials: "same-origin",
      });
      if (!r.ok) {
        detailEl.innerHTML =
          '<p class="messages-detail__placeholder">Could not load this item.</p>';
        setActiveSent(null, false);
        return;
      }
      var data = await r.json();
      var s = data.message;
      var rel = relatedKindLabel(s.related_kind);
      detailEl.innerHTML =
        '<div class="messages-detail__scroll">' +
        '<div class="messages-detail__sent-brand">' +
        '<p class="messages-detail__source">Sent from Messages</p>' +
        "<h1>" +
        esc(s.subject) +
        "</h1>" +
        "</div>" +
        '<div class="messages-detail__sent-main">' +
        '<dl class="messages-detail__fields">' +
        '<div class="messages-detail__field"><dt>To</dt><dd>' +
        esc(s.to_email) +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Send from</dt><dd>' +
        esc(sentFromLabel(s.reply_from)) +
        "</dd></div>" +
        '<div class="messages-detail__field messages-detail__field--wide"><dt>Related</dt><dd>' +
        esc(rel) +
        " · <code class=\"messages-detail__mono\">" +
        esc(s.related_id) +
        "</code></dd></div>" +
        '<div class="messages-detail__field"><dt>Sent by</dt><dd>' +
        esc(s.admin_email || "—") +
        "</dd></div>" +
        '<div class="messages-detail__field"><dt>Sent at</dt><dd>' +
        esc(fmtWhen(s.created_at)) +
        "</dd></div>" +
        "</dl>" +
        '<div class="messages-detail__body messages-detail__body--sent-log">' +
        '<p class="messages-detail__body-label">Body (as sent)</p>' +
        '<pre class="messages-detail__body-pre">' +
        esc(s.body_text) +
        "</pre>" +
        "</div>" +
        '<p class="messages-detail__sent-main-end">This message is a direct reply from Zack&apos;s Maids staff regarding your contact message or job application.</p>' +
        "</div>" +
        "</div>";
      currentSentSelection = String(id);
      setActiveSent(btn, true);
    } catch (e) {
      detailEl.innerHTML =
        '<p class="messages-detail__placeholder">Network error.</p>';
      setActiveSent(null, false);
    }
  }

  async function loadSentPanel() {
    return loadSentPanelInner(false);
  }

  async function loadSentPanelInner(preserveSelection) {
    if (!sidebarEl) return;
    attachSidebarDelegatedClick();
    if (!preserveSelection) {
      currentSentSelection = null;
      lastSentEntriesSig = "";
      clearInboxRowCache();
      clearSentRowCache();
      sidebarEl.innerHTML = '<p class="messages-sidebar__empty">Loading…</p>';
      if (detailEl) {
        detailEl.innerHTML = '<p class="messages-detail__placeholder">Select a sent message.</p>';
      }
    }

    if (!feedMeta.noreplyMailbox) {
      await prefetchFeedMeta();
    }

    try {
      var r = await fetch("/api/admin/sent-messages", { credentials: "same-origin" });
      if (!r.ok) {
        if (!preserveSelection) {
          clearSentRowCache();
          sidebarEl.innerHTML =
            '<p class="messages-sidebar__empty">Could not load sent mail.</p>';
        }
        return;
      }
      var data = await r.json();
      var rows = data.messages || [];
      if (rows.length === 0) {
        currentSentSelection = null;
        lastSentEntriesSig = "";
        clearSentRowCache();
        sidebarEl.innerHTML =
          '<p class="messages-sidebar__empty">No outgoing replies logged yet. Sent mail appears here after you send from the Inbox tab.</p>';
        if (detailEl) {
          detailEl.innerHTML =
            '<p class="messages-detail__placeholder">Select a sent message.</p>';
        }
        return;
      }

      var sentSig = sentEntriesSignature(rows);
      if (
        preserveSelection &&
        sentSig !== "" &&
        sentSig === lastSentEntriesSig &&
        currentSentSelection
      ) {
        var sid = String(currentSentSelection);
        var existingSentBtn = null;
        sidebarEl.querySelectorAll("button.messages-sidebar__select[data-sent-id]").forEach(function (btn) {
          if (existingSentBtn) return;
          if (btn.getAttribute("data-sent-id") === sid) {
            existingSentBtn = btn;
          }
        });
        if (existingSentBtn) {
          setActiveSent(existingSentBtn, true);
          return;
        }
      }
      lastSentEntriesSig = sentSig;

      mergeSentSidebar(rows);

      var pickBtn = null;
      if (preserveSelection && currentSentSelection) {
        var selSid = String(currentSentSelection);
        sidebarEl.querySelectorAll("button.messages-sidebar__select[data-sent-id]").forEach(function (btn) {
          if (pickBtn) return;
          if (btn.getAttribute("data-sent-id") === selSid) {
            pickBtn = btn;
          }
        });
      }

      if (
        preserveSelection &&
        pickBtn &&
        currentSentSelection &&
        pickBtn.getAttribute("data-sent-id") === String(currentSentSelection)
      ) {
        setActiveSent(pickBtn, true);
        return;
      }

      var useBtn = pickBtn || sidebarEl.querySelector("button.messages-sidebar__select[data-sent-id]");
      if (useBtn) {
        showSentDetail(useBtn.getAttribute("data-sent-id"), useBtn);
      }
    } catch (e) {
      if (!preserveSelection) {
        clearSentRowCache();
        sidebarEl.innerHTML = '<p class="messages-sidebar__empty">Cannot reach the API.</p>';
      }
    }
  }

  function applyTab(tab) {
    currentTab = tab;
    if (tabInbox) {
      tabInbox.classList.toggle("is-active", tab === "inbox");
      tabInbox.setAttribute("aria-selected", tab === "inbox");
    }
    if (tabSent) {
      tabSent.classList.toggle("is-active", tab === "sent");
      tabSent.setAttribute("aria-selected", tab === "sent");
    }
    if (tab === "inbox") {
      loadInboxPanel();
    } else {
      loadSentPanel();
    }
  }

  async function init() {
    var me = await loadMe();
    if (!me || !me.loggedIn || !me.isAdmin) {
      showForbidden();
      return;
    }

    if (loadingEl) loadingEl.hidden = true;
    if (layoutEl) layoutEl.hidden = false;

    connectAdminMessagesWs();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (!layoutEl || layoutEl.hidden) return;
      if (visibilityRefetchTimer) clearTimeout(visibilityRefetchTimer);
      visibilityRefetchTimer = setTimeout(function () {
        visibilityRefetchTimer = null;
        if (document.visibilityState !== "visible") return;
        if (!layoutEl || layoutEl.hidden) return;
        if (currentTab === "inbox") loadInboxPanelInner(true);
        else if (currentTab === "sent") loadSentPanelInner(true);
      }, 300);
    });

    if (tabInbox) {
      tabInbox.addEventListener("click", function () {
        if (currentTab !== "inbox") {
          applyTab("inbox");
        }
      });
    }
    if (tabSent) {
      tabSent.addEventListener("click", function () {
        if (currentTab !== "sent") {
          applyTab("sent");
        }
      });
    }

    try {
      applyTab("inbox");
    } catch (e) {
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = "Cannot reach the API.";
      }
      if (layoutEl) layoutEl.hidden = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
