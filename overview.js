/**
 * Admin overview: bookings, filters, cleaner assignment, status, Stripe refunds.
 */
(function () {
  var TIP_CLEANING_TYPE = "tip-2";

  var CLEANING_LABELS = {
    "studio-1br": "Studio / 1 BR",
    "apt-2br": "2 BR apartment",
    "home-3br": "3 BR home",
    deep: "Deep clean",
    "move-in-out": "Move-in / move-out",
    "office-small": "Small office",
    "plan-weekly": "Weekly plan",
    "plan-biweekly": "Bi-weekly plan",
    "plan-monthly": "Monthly plan",
    "post-construction": "Post-construction",
    "tip-2": "$2 tip",
  };

  var STATUS_LABELS = {
    pending_confirmation: "Awaiting approval",
    confirmed: "Confirmed",
    in_progress: "In progress",
    completed: "Completed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    refunded: "Refunded",
    removed_by_admin: "Removed (admin)",
  };

  var employees = [];

  function cleaningLabel(type) {
    return CLEANING_LABELS[type] || type || "—";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "—";
  }

  function isTipBooking(b) {
    return b && (b.is_tip === true || b.cleaning_type === TIP_CLEANING_TYPE);
  }

  function formatAddons(addons) {
    if (!addons || !Array.isArray(addons) || addons.length === 0) return "—";
    return addons.join(", ");
  }

  function formatWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? "—" : d.toLocaleString();
    } catch (e) {
      return "—";
    }
  }

  function formatPaidAmount(b) {
    var cents = b.checkout_amount_cents != null ? Number(b.checkout_amount_cents) : NaN;
    if (!Number.isFinite(cents) || cents <= 0) return "—";
    return "$" + (cents / 100).toFixed(2);
  }

  function rowHasOnlinePayment(b) {
    var pay = b.square_payment_id && String(b.square_payment_id).trim();
    var cents = b.checkout_amount_cents != null ? Number(b.checkout_amount_cents) : NaN;
    return !!(pay && Number.isFinite(cents) && cents > 0);
  }

  function rowCanRefund(b) {
    return rowHasOnlinePayment(b) && !b.square_refund_id && b.status !== "refunded";
  }

  function statusBadge(status) {
    var s = String(status || "");
    var cls = "overview-status";
    if (s === "pending_confirmation") cls += " overview-status--pending";
    else if (s === "confirmed" || s === "completed") cls += " overview-status--ok";
    else if (s === "in_progress") cls += " overview-status--progress";
    else if (s === "rejected" || s === "cancelled") cls += " overview-status--bad";
    else if (s === "refunded" || s === "removed_by_admin") cls += " overview-status--muted";
    else cls += " overview-status--muted";
    var span = document.createElement("span");
    span.className = cls;
    span.textContent = statusLabel(s);
    return span;
  }

  function tdText(text) {
    var td = document.createElement("td");
    td.textContent = text == null || text === "" ? "—" : String(text);
    return td;
  }

  function tdAddressScrollable(text) {
    var td = document.createElement("td");
    td.className = "overview-table-address-cell";
    var box = document.createElement("div");
    box.className = "overview-table-address-scroll";
    box.textContent = text == null || text === "" ? "—" : String(text);
    box.setAttribute("tabindex", "0");
    box.setAttribute("title", box.textContent);
    td.appendChild(box);
    return td;
  }

  async function postJson(url) {
    var r = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    var data = await r.json().catch(function () {
      return {};
    });
    return { ok: r.ok, status: r.status, data: data };
  }

  async function patchJson(url, body) {
    var r = await fetch(url, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    var data = await r.json().catch(function () {
      return {};
    });
    return { ok: r.ok, status: r.status, data: data };
  }

  function populateEmployeeSelect(selectEl, includeUnassigned, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    if (includeUnassigned) {
      var un = document.createElement("option");
      un.value = "";
      un.textContent = "Unassigned";
      selectEl.appendChild(un);
    }
    employees.forEach(function (emp) {
      if (!emp.active) return;
      var opt = document.createElement("option");
      opt.value = emp.id;
      opt.textContent = emp.name;
      selectEl.appendChild(opt);
    });
    if (selectedId) selectEl.value = selectedId;
    else if (includeUnassigned) selectEl.value = "";
  }

  function populateAssignedFilter(selectEl, current) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    var all = document.createElement("option");
    all.value = "all";
    all.textContent = "Any cleaner";
    selectEl.appendChild(all);
    var un = document.createElement("option");
    un.value = "unassigned";
    un.textContent = "Unassigned only";
    selectEl.appendChild(un);
    employees.forEach(function (emp) {
      if (!emp.active) return;
      var opt = document.createElement("option");
      opt.value = emp.id;
      opt.textContent = emp.name;
      selectEl.appendChild(opt);
    });
    selectEl.value = current || "all";
  }

  async function loadEmployees() {
    var r = await fetch("/api/admin/employees?active_only=1", { credentials: "same-origin" });
    var data = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) throw new Error(data.error || "Could not load employees.");
    employees = data.employees || [];
  }

  async function run() {
    var loading = document.getElementById("overview-loading");
    var content = document.getElementById("overview-content");
    var tbody = document.getElementById("overview-tbody");
    var toastEl = document.getElementById("overview-toast");
    var statTotal = document.getElementById("stat-total-bookings");
    var statPending = document.getElementById("stat-pending-approval");
    var statTotalLabel = document.getElementById("stat-total-label");
    var typeFilterEl = document.getElementById("overview-booking-filter");
    var statusFilterEl = document.getElementById("overview-status-filter");
    var assignedFilterEl = document.getElementById("overview-assigned-filter");

    var listTypeFilter = "all";
    var listStatusFilter = "all";
    var listAssignedFilter = "all";

    try {
      var r = await fetch("/api/auth/me", { credentials: "same-origin" });
      var me = await r.json();
      if (!me.loggedIn || !me.isAdmin) {
        window.location.replace("/login.html");
        return;
      }
    } catch (e) {
      window.location.replace("/login.html");
      return;
    }

    try {
      await loadEmployees();
    } catch (empErr) {
      if (loading) loading.textContent = empErr.message || "Could not load cleaners.";
      return;
    }

    populateAssignedFilter(assignedFilterEl, listAssignedFilter);

    loading.hidden = true;
    content.hidden = false;

    function onFilterChange() {
      refresh();
    }

    if (typeFilterEl) typeFilterEl.addEventListener("change", onFilterChange);
    if (statusFilterEl) statusFilterEl.addEventListener("change", onFilterChange);
    if (assignedFilterEl) assignedFilterEl.addEventListener("change", onFilterChange);

    async function refresh() {
      toastEl.textContent = "";
      tbody.innerHTML = "";

      listTypeFilter = typeFilterEl && typeFilterEl.value === "tips" ? "tips" : "all";
      listStatusFilter = statusFilterEl ? statusFilterEl.value : "all";
      listAssignedFilter = assignedFilterEl ? assignedFilterEl.value : "all";

      var params = [];
      if (listTypeFilter === "tips") params.push("tips_only=1");
      if (listStatusFilter && listStatusFilter !== "all") params.push("status=" + encodeURIComponent(listStatusFilter));
      if (listAssignedFilter && listAssignedFilter !== "all") {
        params.push("assigned_to=" + encodeURIComponent(listAssignedFilter));
      }
      var listUrl = "/api/admin/bookings" + (params.length ? "?" + params.join("&") : "");

      var rb = await fetch(listUrl, { credentials: "same-origin" });
      var payload = await rb.json().catch(function () {
        return {};
      });
      if (!rb.ok) {
        var errTr = document.createElement("tr");
        var errTd = document.createElement("td");
        errTd.colSpan = 12;
        errTd.textContent = payload.error || "Could not load bookings.";
        errTr.appendChild(errTd);
        tbody.appendChild(errTr);
        return;
      }

      var bookings = payload.bookings || [];
      var pending = bookings.filter(function (b) {
        return b.status === "pending_confirmation";
      }).length;

      statTotal.textContent = String(bookings.length);
      statPending.textContent = String(pending);
      if (statTotalLabel) {
        statTotalLabel.textContent = "Rows in this list";
      }

      if (bookings.length === 0) {
        var emptyTr = document.createElement("tr");
        var emptyTd = document.createElement("td");
        emptyTd.colSpan = 12;
        emptyTd.textContent = "No bookings match these filters.";
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
        return;
      }

      bookings.forEach(function (b) {
        var tr = document.createElement("tr");
        if (isTipBooking(b)) tr.classList.add("overview-row--tip");

        var tdId = document.createElement("td");
        tdId.textContent = String(b.id || "").slice(0, 8) + "…";

        var tdStatus = document.createElement("td");
        tdStatus.appendChild(statusBadge(b.status));
        var statusSel = document.createElement("select");
        statusSel.className = "overview-inline-select";
        statusSel.dataset.action = "set-status";
        statusSel.dataset.bookingId = b.id;
        [
          "pending_confirmation",
          "confirmed",
          "in_progress",
          "completed",
          "rejected",
          "cancelled",
        ].forEach(function (st) {
          var opt = document.createElement("option");
          opt.value = st;
          opt.textContent = statusLabel(st);
          statusSel.appendChild(opt);
        });
        statusSel.value = b.status || "pending_confirmation";
        tdStatus.appendChild(document.createElement("br"));
        tdStatus.appendChild(statusSel);

        var customer =
          (b.name && String(b.name).trim()) ||
          String(b.email || "").split("@")[0] ||
          "—";
        var tdCust = tdText(customer + " (" + (b.email || "—") + ")");

        var svcText = isTipBooking(b) ? "$2 tip" : cleaningLabel(b.cleaning_type);
        var tdSvc = tdText(svcText);
        var tdPaid = tdText(formatPaidAmount(b));
        var tdAddons = tdText(formatAddons(b.addons));
        var tdAddr = tdAddressScrollable(b.address);
        var tdNotes = tdText(b.notes);
        var tdWhen = tdText(formatWhen(b.created_at));

        var tdCleaner = document.createElement("td");
        var assignSel = document.createElement("select");
        assignSel.className = "overview-inline-select";
        assignSel.dataset.action = "assign";
        assignSel.dataset.bookingId = b.id;
        populateEmployeeSelect(assignSel, true, b.assigned_employee_id || "");
        tdCleaner.appendChild(assignSel);
        if (b.assigned_employee_name) {
          var hint = document.createElement("div");
          hint.className = "overview-cell-hint";
          hint.textContent = b.assigned_employee_name;
          tdCleaner.appendChild(hint);
        }

        var tdAct = document.createElement("td");
        tdAct.style.whiteSpace = "normal";

        if (b.status === "pending_confirmation") {
          var btnOk = document.createElement("button");
          btnOk.type = "button";
          btnOk.className = "btn-primary overview-action-btn";
          btnOk.textContent = "Confirm";
          btnOk.dataset.action = "confirm";
          btnOk.dataset.bookingId = b.id;
          var btnNo = document.createElement("button");
          btnNo.type = "button";
          btnNo.className = "overview-action-btn overview-action-btn--secondary";
          btnNo.textContent = "Reject";
          btnNo.dataset.action = "reject";
          btnNo.dataset.bookingId = b.id;
          tdAct.appendChild(btnOk);
          tdAct.appendChild(document.createTextNode(" "));
          tdAct.appendChild(btnNo);
        }

        if (rowCanRefund(b)) {
          if (tdAct.childNodes.length) tdAct.appendChild(document.createTextNode(" "));
          var btnRefund = document.createElement("button");
          btnRefund.type = "button";
          btnRefund.className = "overview-action-btn overview-action-btn--warn";
          btnRefund.textContent = "Refund";
          btnRefund.title = "Refund the card payment via Stripe (booking stays in the list)";
          btnRefund.dataset.action = "refund";
          btnRefund.dataset.bookingId = b.id;
          btnRefund.dataset.amountCents = String(Number(b.checkout_amount_cents));
          tdAct.appendChild(btnRefund);
        }

        var canRefundRemove = rowHasOnlinePayment(b) && !b.square_refund_id && b.status !== "refunded";
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "overview-action-btn overview-action-btn--danger";
        rm.textContent = canRefundRemove ? "Refund & remove" : "Remove…";
        rm.title = canRefundRemove
          ? "Full refund via Stripe and hide from this list"
          : "Hide from overview (no card payment on record)";
        rm.dataset.action = "refund-remove";
        rm.dataset.bookingId = b.id;
        rm.dataset.canRefund = canRefundRemove ? "1" : "0";
        if (canRefundRemove && b.checkout_amount_cents != null) {
          rm.dataset.amountCents = String(Number(b.checkout_amount_cents));
        }
        if (tdAct.childNodes.length) tdAct.appendChild(document.createTextNode(" "));
        tdAct.appendChild(rm);

        tr.appendChild(tdId);
        tr.appendChild(tdStatus);
        tr.appendChild(tdCust);
        tr.appendChild(tdSvc);
        tr.appendChild(tdPaid);
        tr.appendChild(tdCleaner);
        tr.appendChild(tdAddons);
        tr.appendChild(tdAddr);
        tr.appendChild(tdNotes);
        tr.appendChild(tdWhen);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
    }

    tbody.addEventListener("change", async function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.bookingId || !t.dataset.action) return;
      var id = t.dataset.bookingId;
      var action = t.dataset.action;
      var prevValue = t.dataset.prevValue || t.value;

      if (action === "assign") {
        t.disabled = true;
        var assignResult = await patchJson("/api/admin/bookings/" + encodeURIComponent(id) + "/assign", {
          employeeId: t.value || null,
        });
        t.disabled = false;
        if (!assignResult.ok) {
          toastEl.textContent = assignResult.data.error || "Could not assign cleaner.";
          t.value = prevValue;
          return;
        }
        toastEl.textContent = "Cleaner assignment updated.";
        await refresh();
        return;
      }

      if (action === "set-status") {
        if (t.value === prevValue) return;
        t.disabled = true;
        var statusResult = await patchJson("/api/admin/bookings/" + encodeURIComponent(id) + "/status", {
          status: t.value,
        });
        t.disabled = false;
        if (!statusResult.ok) {
          toastEl.textContent = statusResult.data.error || "Could not update status.";
          t.value = prevValue;
          return;
        }
        toastEl.textContent = "Status updated to " + statusLabel(t.value) + ".";
        await refresh();
      }
    });

    tbody.addEventListener("focusin", function (ev) {
      var t = ev.target;
      if (t && t.tagName === "SELECT" && t.dataset) {
        t.dataset.prevValue = t.value;
      }
    });

    tbody.addEventListener("click", async function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.bookingId || !t.dataset.action) return;
      var action = t.dataset.action;
      var id = t.dataset.bookingId;

      if (action === "refund") {
        var centsStr = t.dataset.amountCents || "";
        var dollars = centsStr && Number.isFinite(Number(centsStr)) ? (Number(centsStr) / 100).toFixed(2) : "";
        if (
          !window.confirm(
            "Refund $" +
              dollars +
              " USD to the customer's card via Stripe?\n\nThe booking will stay in this list with status Refunded.",
          )
        ) {
          return;
        }
        t.disabled = true;
        t.textContent = "Refunding…";
        var refundResult = await postJson("/api/admin/bookings/" + encodeURIComponent(id) + "/refund");
        t.disabled = false;
        t.textContent = "Refund";
        if (!refundResult.ok) {
          toastEl.textContent = refundResult.data.error || "Refund failed.";
          return;
        }
        toastEl.textContent = "Refund issued to the customer's card.";
        await refresh();
        return;
      }

      if (action === "refund-remove") {
        var canRefund = t.dataset.canRefund === "1";
        var centsStr2 = t.dataset.amountCents || "";
        var dollars2 = centsStr2 && Number.isFinite(Number(centsStr2)) ? (Number(centsStr2) / 100).toFixed(2) : "";
        var msg = canRefund
          ? "Refund $" +
            dollars2 +
            " USD via Stripe and remove this booking from the overview?\n\nThe row stays in the database."
          : "Remove this booking from the overview only?\n\nNo card payment will be refunded.";
        if (!window.confirm(msg)) return;

        var row = t.closest("tr");
        var rowBtns = row ? row.querySelectorAll("button") : [];
        rowBtns.forEach(function (btn) {
          btn.disabled = true;
        });
        t.textContent = canRefund ? "Refunding…" : "Removing…";

        var result = await postJson(
          "/api/admin/bookings/" + encodeURIComponent(id) + "/refund-and-remove",
        );

        rowBtns.forEach(function (btn) {
          btn.disabled = false;
        });
        t.textContent = canRefund ? "Refund & remove" : "Remove…";

        if (!result.ok) {
          toastEl.textContent = result.data.error || "Request failed.";
          return;
        }
        toastEl.textContent = result.data.refunded
          ? "Refund recorded and booking hidden from overview."
          : "Booking hidden from overview.";
        await refresh();
        return;
      }

      if (action !== "confirm" && action !== "reject") return;

      var url =
        action === "confirm"
          ? "/api/admin/bookings/" + encodeURIComponent(id) + "/confirm"
          : "/api/admin/bookings/" + encodeURIComponent(id) + "/reject";
      var row2 = t.closest("tr");
      var rowBtns2 = row2 ? row2.querySelectorAll("button") : [];
      var prevLabels = [];
      rowBtns2.forEach(function (btn) {
        prevLabels.push(btn.textContent);
        btn.disabled = true;
      });
      t.textContent = action === "confirm" ? "Confirming…" : "Rejecting…";
      var result2 = await postJson(url);
      if (!result2.ok) {
        rowBtns2.forEach(function (btn, i) {
          btn.disabled = false;
          btn.textContent = prevLabels[i] || btn.textContent;
        });
        toastEl.textContent = result2.data.error || "Request failed.";
        return;
      }
      toastEl.textContent =
        action === "confirm"
          ? isTipBooking(result2.data.booking)
            ? "Tip confirmed."
            : "Booking confirmed."
          : isTipBooking(result2.data.booking)
            ? "Tip rejected."
            : "Booking rejected.";
      await refresh();
    });

    await refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
