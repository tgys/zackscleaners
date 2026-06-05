/**
 * Admin-only: business signature for inbox reply emails.
 */
(function () {
  async function loadSettings(nameEl, phoneEl, emailEl, addrEl) {
    var r = await fetch("/api/admin/business-settings", { credentials: "same-origin" });
    var data = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw new Error(data.error || "Could not load settings.");
    }
    nameEl.value = data.displayName != null ? String(data.displayName) : "";
    phoneEl.value = data.phone != null ? String(data.phone) : "";
    emailEl.value = data.signatureEmail != null ? String(data.signatureEmail) : "";
    addrEl.value = data.address != null ? String(data.address) : "";
  }

  async function run() {
    var loading = document.getElementById("admin-settings-loading");
    var main = document.getElementById("admin-settings-main");
    var form = document.getElementById("admin-settings-form");
    if (!loading || !main || !form) return;

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

    var nameEl = document.getElementById("settings-signature-name");
    var phoneEl = document.getElementById("settings-signature-phone");
    var emailEl = document.getElementById("settings-signature-email");
    var addrEl = document.getElementById("settings-signature-address");
    var errBox = document.getElementById("settings-save-err");
    var okBox = document.getElementById("settings-save-ok");

    try {
      await loadSettings(nameEl, phoneEl, emailEl, addrEl);
    } catch (e) {
      loading.textContent = e.message || "Could not load settings.";
      return;
    }

    loading.hidden = true;
    main.hidden = false;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        btn.textContent = "Saving…";
      }

      try {
        var body = {
          displayName: nameEl ? nameEl.value : "",
          phone: phoneEl ? phoneEl.value : "",
          signatureEmail: emailEl ? emailEl.value : "",
          address: addrEl ? addrEl.value : "",
        };
        var sr = await fetch("/api/admin/business-settings", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        var sdata = await sr.json().catch(function () {
          return {};
        });
        if (!sr.ok) {
          if (errBox) {
            errBox.textContent = sdata.error || "Could not save.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        if (okBox) {
          okBox.textContent = "Saved.";
          okBox.hidden = false;
        }
      } catch (ex) {
        if (errBox) {
          errBox.textContent = "Cannot reach the server.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Save";
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
