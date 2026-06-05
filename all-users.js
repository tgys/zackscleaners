/**
 * Admin: registered users table + detail panel below list (bookings / cancellations).
 */
(function () {
  var tbody = document.getElementById("all-users-tbody");
  var loadingEl = document.getElementById("all-users-loading");
  var contentEl = document.getElementById("all-users-content");
  var errorEl = document.getElementById("all-users-error");
  var detailTitle = document.getElementById("all-users-detail-title");
  var detailBody = document.getElementById("all-users-detail-body");

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (e) {
      return "—";
    }
  }

  function esc(s) {
    if (s == null || s === "") return "—";
    return String(s);
  }

  function formatAddons(addons) {
    if (addons == null) return "—";
    if (Array.isArray(addons)) return addons.length ? addons.join(", ") : "—";
    if (typeof addons === "object") {
      try {
        return JSON.stringify(addons);
      } catch (e) {
        return "—";
      }
    }
    return String(addons);
  }

  function renderBookingCard(b) {
    var dl = document.createElement("dl");
    function row(label, val) {
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      dd.textContent = val;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    row("When requested", fmtDate(b.created_at));
    row("Address", esc(b.address));
    row("Service", esc(b.cleaning_type));
    row("Add-ons", formatAddons(b.addons));
    row("Notes", esc(b.notes));
    row("Status", esc(b.status));
    if (b.cancelled_at) {
      row("Cancelled at", fmtDate(b.cancelled_at));
    }
    var li = document.createElement("li");
    li.className = "all-users-detail-card";
    li.appendChild(dl);
    return li;
  }

  function renderSection(title, items, emptyMsg) {
    var frag = document.createDocumentFragment();
    var h3 = document.createElement("h3");
    h3.className = "all-users-detail-section-title";
    h3.textContent = title;
    frag.appendChild(h3);
    if (!items || items.length === 0) {
      var p = document.createElement("p");
      p.className = "all-users-detail-muted";
      p.textContent = emptyMsg;
      frag.appendChild(p);
      return frag;
    }
    var ul = document.createElement("ul");
    ul.className = "all-users-detail-list";
    items.forEach(function (b) {
      ul.appendChild(renderBookingCard(b));
    });
    frag.appendChild(ul);
    return frag;
  }

  function renderUserDetail(data) {
    detailBody.innerHTML = "";
    var u = data.user;
    var displayName = (u.name && String(u.name).trim()) || u.email || "User";

    if (detailTitle) detailTitle.textContent = displayName;

    var meta = document.createElement("dl");
    meta.className = "all-users-detail-meta";
    function metaRow(term, val) {
      var dt = document.createElement("dt");
      dt.textContent = term;
      var dd = document.createElement("dd");
      dd.textContent = val;
      meta.appendChild(dt);
      meta.appendChild(dd);
    }
    metaRow("Username", esc(u.name));
    metaRow("Email", esc(u.email));
    metaRow("Address", esc(u.address));
    metaRow("Registered", fmtDate(u.created_at));
    metaRow("Email verified", fmtDate(u.email_verified_at));
    metaRow("Last login", fmtDate(u.last_login_at));
    dlgBody.appendChild(meta);

    dlgBody.appendChild(
      renderSection("Bookings", data.bookings, "No active bookings on file."),
    );
    dlgBody.appendChild(
      renderSection("Cancellations", data.cancellations, "No cancellations on file."),
    );
  }

  function showDetailPlaceholder() {
    if (detailTitle) detailTitle.textContent = "User details";
    dlgBody.innerHTML = "";
    var p = document.createElement("p");
    p.className = "all-users-detail-placeholder";
    p.textContent =
      "Select a user in the table above to view full details, bookings, and cancellations.";
    dlgBody.appendChild(p);
  }

  function setDetailLoading() {
    if (detailTitle) detailTitle.textContent = "User details";
    dlgBody.innerHTML = "";
    var p = document.createElement("p");
    p.className = "all-users-detail-loading";
    p.textContent = "Loading…";
    dlgBody.appendChild(p);
  }

  function setSelectedRow(tr) {
    if (!tbody) return;
    tbody.querySelectorAll("tr.is-selected").forEach(function (row) {
      row.classList.remove("is-selected");
    });
    if (tr) tr.classList.add("is-selected");
  }

  async function openUserDetail(userId, tr) {
    setSelectedRow(tr || null);
    setDetailLoading();
    try {
      var r = await fetch("/api/admin/users/" + encodeURIComponent(userId), {
        credentials: "same-origin",
      });
      if (!r.ok) {
        dlgBody.innerHTML = "";
        var err = document.createElement("p");
        err.className = "all-users-error";
        err.style.margin = "0";
        err.textContent = r.status === 404 ? "User not found." : "Could not load user.";
        dlgBody.appendChild(err);
        return;
      }
      var data = await r.json();
      renderUserDetail(data);
    } catch (e) {
      dlgBody.innerHTML = "";
      var err = document.createElement("p");
      err.className = "all-users-error";
      err.style.margin = "0";
      err.textContent = "Network error.";
      dlgBody.appendChild(err);
    }
  }

  function renderRows(users) {
    tbody.innerHTML = "";
    showDetailPlaceholder();
    if (!users.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6;
      td.className = "all-users-empty";
      td.textContent = "No registered users yet.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    users.forEach(function (u) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-user-id", u.id);
      tr.setAttribute("role", "button");
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", "View details for " + (u.email || "user"));

      function cell(text) {
        var td = document.createElement("td");
        td.textContent = text != null && text !== "" ? String(text) : "—";
        return td;
      }

      tr.appendChild(cell((u.name && String(u.name).trim()) || "—"));
      tr.appendChild(cell(u.email));
      tr.appendChild(cell(u.address));
      tr.appendChild(cell(fmtDate(u.created_at)));
      tr.appendChild(cell(fmtDate(u.last_login_at)));
      tr.appendChild(cell(u.email_verified_at ? fmtDate(u.email_verified_at) : "Pending"));
      tbody.appendChild(tr);
    });
  }

  async function run() {
    try {
      var meR = await fetch("/api/auth/me", { credentials: "same-origin" });
      var me = await meR.json();
      if (!me.loggedIn || !me.isAdmin) {
        window.location.replace("/login.html");
        return;
      }
    } catch (e) {
      window.location.replace("/login.html");
      return;
    }

    loadingEl.hidden = true;
    contentEl.hidden = false;

    if (!tbody || !detailBody) return;

    showDetailPlaceholder();

    try {
      var r = await fetch("/api/admin/users", { credentials: "same-origin" });
      if (!r.ok) {
        errorEl.hidden = false;
        errorEl.textContent =
          r.status === 403 ? "You don’t have access to this page." : "Could not load users.";
        return;
      }
      errorEl.hidden = true;
      errorEl.textContent = "";
      var data = await r.json();
      renderRows(data.users || []);
    } catch (e) {
      errorEl.hidden = false;
      errorEl.textContent = "Cannot reach the API.";
    }

    tbody.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-user-id]");
      if (!tr) return;
      openUserDetail(tr.getAttribute("data-user-id"), tr);
    });

    tbody.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var tr = e.target.closest("tr[data-user-id]");
      if (!tr) return;
      e.preventDefault();
      openUserDetail(tr.getAttribute("data-user-id"), tr);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
