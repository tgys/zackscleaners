    bindContactForm();
    bindRecruitmentForm();    });
  }

  function bindRecruitmentForm() {
    var form = document.getElementById("recruitment-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = document.getElementById("recruitment-error");
      var okBox = document.getElementById("recruitment-success");
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var nameVal = document.getElementById("recruitment-name").value.trim();
      var addressVal = document.getElementById("recruitment-address").value.trim();
      var emailVal = document.getElementById("recruitment-email").value.trim();
      var recruitmentPhonePrefixSelect = document.getElementById("recruitment-phone-prefix");
      var nationalEl = document.getElementById("recruitment-phone-national");
      var cvEl = document.getElementById("recruitment-cv");

      var phonePrefix = recruitmentPhonePrefixSelect
        ? String(recruitmentPhonePrefixSelect.value).trim()
        : "";
      var nationalDigits = contactNormalizeNational(
        phonePrefix,
        nationalEl ? nationalEl.value : "",
      );

      if (!nameVal) {
        if (errBox) {
          errBox.textContent = "Please enter your full name.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (CONTACT_NAME_CTRL_RE.test(nameVal)) {
        if (errBox) {
          errBox.textContent = "Name contains invalid characters.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!addressVal) {
        if (errBox) {
          errBox.textContent = "Please enter your address including postcode.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (CONTACT_NAME_CTRL_RE.test(addressVal)) {
        if (errBox) {
          errBox.textContent = "Address contains invalid characters.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!emailVal) {
        if (errBox) {
          errBox.textContent = "Please enter your email.";
          errBox.classList.add("is-visible");
        }
        return;
      }

      if (!contactPhoneClientOk(phonePrefix, nationalDigits, recruitmentPhonePrefixSelect)) {
        if (errBox) {
          errBox.textContent =
            "Check your mobile number for the selected country code (digits only; country + number at most 15 digits after formatting).";
          errBox.classList.add("is-visible");
        }
        return;
      }

      if (!cvEl || !cvEl.files || !cvEl.files[0]) {
        if (errBox) {
          errBox.textContent = "Please attach your CV as a PDF.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      var file = cvEl.files[0];
      var lowerName = (file.name || "").toLowerCase();
      if (!lowerName.endsWith(".pdf")) {
        if (errBox) {
          errBox.textContent = "CV must be a PDF file.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      var mt = (file.type || "").toLowerCase();
      if (
        mt &&
        mt !== "application/pdf" &&
        mt !== "application/x-pdf"
      ) {
        if (errBox) {
          errBox.textContent = "CV must be a PDF file.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (file.size > RECRUITMENT_CV_MAX_BYTES) {
        if (errBox) {
          errBox.textContent =
            "PDF is too large — maximum " +
            RECRUITMENT_CV_MAX_BYTES / (1024 * 1024) +
            " MB (about one page).";
          errBox.classList.add("is-visible");
        }
        return;
      }

      var fd = new FormData();
      fd.append("name", nameVal);
      fd.append("address", addressVal);
      fd.append("email", emailVal);
      fd.append("phonePrefix", phonePrefix);
      fd.append("phoneNational", nationalDigits);
      fd.append("cv", file, file.name);

      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        btn.textContent = "Submitting…";
      }

      try {
        var r = await fetch("/api/recruitment", {
          method: "POST",
          credentials: "same-origin",
          body: fd,
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (errBox) {
            errBox.textContent = data.error || "Could not submit your application.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        form.reset();
        if (okBox) {
          okBox.textContent = "Thank you — we received your application.";
          okBox.hidden = false;
        }
      } catch (ex) {
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use the live site URL with the server running.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Submit application";
        }
      }
    });
  }

  function bindLoginForm() {  var CONTACT_PHONE_RULES = {
    "+1": /^[2-9]\d{2}[2-9]\d{6}$/,
    "+44": /^7\d{9}$/,
    "+91": /^[6-9]\d{9}$/,
  };

  /** Must match server CV_MAX_BYTES in recruitmentRoutes.js (~single-page PDF). */
  var RECRUITMENT_CV_MAX_BYTES = 1048576;

  /** Must match server CV_MAX_BYTES in recruitmentRoutes.js (~single-page PDF). */
  var RECRUITMENT_CV_MAX_BYTES = 1048576;    bindRegistrationVerifyPendingPage(params);
    }
  }

  function bindContactForm() {/**
 * Auth UI: nav sync (/api/auth/me), login & register forms. All logic lives here so
 * Helmet’s default CSP (no inline scripts) does not break the pages.
 */
(function () {
  function showQueryParamErrors() {
    var params = new URLSearchParams(window.location.search);
    var err = params.get("error") || params.get("error_description");
    var decoded = err ? err.replace(/\+/g, " ") : "";
    var loginBox = document.getElementById("login-error");
    var registerBox = document.getElementById("register-error");
    if (decoded && loginBox && document.getElementById("login-form")) {
      loginBox.textContent = decoded;
      loginBox.classList.add("is-visible");
    }
    if (decoded && registerBox && document.getElementById("register-form")) {
      registerBox.textContent = decoded;
      registerBox.classList.add("is-visible");
    }

    if (params.get("reset") === "ok") {
      var note = document.getElementById("login-reset-note");
      if (note) note.hidden = false;
    }
  }

  /** Mirrors server/src/contactRoutes.js — title single-line ASCII printable only; body allows CRLF/tab. */
  var CONTACT_ASCII_TITLE_RE = /^[\x20-\x7E]+$/;
  var CONTACT_ASCII_BODY_RE = /^[\x20-\x7E\r\n\t]+$/;
  var CONTACT_NAME_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
  var CONTACT_PHONE_RULES = {
    "+1": /^[2-9]\d{2}[2-9]\d{6}$/,
    "+44": /^7\d{9}$/,
    "+91": /^[6-9]\d{9}$/,
  };

  function contactDigitsOnly(s) {
    return String(s).replace(/\D/g, "");
  }

  function contactNormalizeNational(prefix, raw) {
    var d = contactDigitsOnly(raw);
    if (prefix === "+44" && d.charAt(0) === "0") d = d.slice(1);
    return d;
  }

  function bindContactForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = document.getElementById("contact-error");
      var okBox = document.getElementById("contact-success");
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var contactPhonePrefixSelect = document.getElementById("contact-phone-prefix");
      var nationalEl = document.getElementById("contact-phone-national");
      var phonePrefix = contactPhonePrefixSelect
        ? String(contactPhonePrefixSelect.value).trim()
        : "";
      var phoneNationalRaw = nationalEl ? nationalEl.value : "";
      var nationalDigits = contactNormalizeNational(phonePrefix, phoneNationalRaw);
      var titleVal = document.getElementById("contact-title").value.trim();
      var bodyVal = document.getElementById("contact-body").value.trim();
      var nameVal = document.getElementById("contact-name").value.trim();

      if (!document.getElementById("contact-email").value.trim()) {
        if (errBox) {
          errBox.textContent = "Please enter your email.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!nameVal) {
        if (errBox) {
          errBox.textContent = "Please enter your name.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (CONTACT_NAME_CTRL_RE.test(nameVal)) {
        if (errBox) {
          errBox.textContent = "Name contains invalid characters.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!titleVal || !CONTACT_ASCII_TITLE_RE.test(titleVal)) {
        if (errBox) {
          errBox.textContent =
            "Title must use plain ASCII only (letters, numbers, punctuation — no emoji).";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!bodyVal || !CONTACT_ASCII_BODY_RE.test(bodyVal)) {
        if (errBox) {
          errBox.textContent =
            "Message must use plain ASCII only (line breaks are fine; no emoji or Unicode).";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!contactPhoneClientOk(phonePrefix, nationalDigits, contactPhonePrefixSelect)) {
        if (errBox) {
          errBox.textContent =
            "Check your mobile number for the selected country code (digits only; country + number at most 15 digits after formatting).";
          errBox.classList.add("is-visible");
        }
        return;
      }

      var payload = {
        email: document.getElementById("contact-email").value.trim(),
        name: nameVal,
        phonePrefix: phonePrefix,
        phoneNational: nationalDigits,
        title: titleVal,
        body: bodyVal,
      };

      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        btn.textContent = "Sending…";
      }

      try {
        var r = await fetch("/api/contact", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (errBox) {
            errBox.textContent = data.error || "Could not send your message.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        form.reset();
        if (okBox) {
          okBox.textContent = "Thank you — your message was sent.";
          okBox.hidden = false;
        }
      } catch (ex) {
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use the live site URL with the server running.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Send message";
        }
      }
    });
  }

  function bindRecruitmentForm() {
    var form = document.getElementById("recruitment-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = document.getElementById("recruitment-error");
      var okBox = document.getElementById("recruitment-success");
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var nameVal = document.getElementById("recruitment-name").value.trim();
      var addressVal = document.getElementById("recruitment-address").value.trim();
      var emailVal = document.getElementById("recruitment-email").value.trim();
      var prefixEl = document.getElementById("recruitment-phone-prefix");
      var nationalEl = document.getElementById("recruitment-phone-national");
      var cvEl = document.getElementById("recruitment-cv");

      var phonePrefix = prefixEl ? String(prefixEl.value).trim() : "";
      var nationalDigits = contactNormalizeNational(
        phonePrefix,
        nationalEl ? nationalEl.value : "",
      );

      if (!nameVal) {
        if (errBox) {
          errBox.textContent = "Please enter your full name.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (CONTACT_NAME_CTRL_RE.test(nameVal)) {
        if (errBox) {
          errBox.textContent = "Name contains invalid characters.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!addressVal) {
        if (errBox) {
          errBox.textContent = "Please enter your address including postcode.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (CONTACT_NAME_CTRL_RE.test(addressVal)) {
        if (errBox) {
          errBox.textContent = "Address contains invalid characters.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (!emailVal) {
        if (errBox) {
          errBox.textContent = "Please enter your email.";
          errBox.classList.add("is-visible");
        }
        return;
      }

      if (!contactPhoneClientOk(phonePrefix, nationalDigits, prefixEl)) {
        if (errBox) {
          errBox.textContent =
            "Check your mobile number for the selected country code (digits only; country + number at most 15 digits after formatting).";
          errBox.classList.add("is-visible");
        }
        return;
      }

      if (!cvEl || !cvEl.files || !cvEl.files[0]) {
        if (errBox) {
          errBox.textContent = "Please attach your CV as a PDF.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      var file = cvEl.files[0];
      var lowerName = (file.name || "").toLowerCase();
      if (!lowerName.endsWith(".pdf")) {
        if (errBox) {
          errBox.textContent = "CV must be a PDF file.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      var mt = (file.type || "").toLowerCase();
      if (
        mt &&
        mt !== "application/pdf" &&
        mt !== "application/x-pdf"
      ) {
        if (errBox) {
          errBox.textContent = "CV must be a PDF file.";
          errBox.classList.add("is-visible");
        }
        return;
      }
      if (file.size > RECRUITMENT_CV_MAX_BYTES) {
        if (errBox) {
          errBox.textContent =
            "PDF is too large — maximum " +
            RECRUITMENT_CV_MAX_BYTES / (1024 * 1024) +
            " MB (about one page).";
          errBox.classList.add("is-visible");
        }
        return;
      }

      var fd = new FormData();
      fd.append("name", nameVal);
      fd.append("address", addressVal);
      fd.append("email", emailVal);
      fd.append("phonePrefix", phonePrefix);
      fd.append("phoneNational", nationalDigits);
      fd.append("cv", file, file.name);

      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        btn.textContent = "Submitting…";
      }

      try {
        var r = await fetch("/api/recruitment", {
          method: "POST",
          credentials: "same-origin",
          body: fd,
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (errBox) {
            errBox.textContent = data.error || "Could not submit your application.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        form.reset();
        if (okBox) {
          okBox.textContent = "Thank you — we received your application.";
          okBox.hidden = false;
        }
      } catch (ex) {
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use the live site URL with the server running.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Submit application";
        }
      }
    });
  }

  function bindLoginForm() {
    var form = document.getElementById("login-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var box = document.getElementById("login-error");
      box.classList.remove("is-visible");
      box.textContent = "";
      var btn = form.querySelector('button[type="submit"]');
      var email = document.getElementById("login-email").value.trim();
      var password = document.getElementById("login-password").value;
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Signing in…";
      }
      try {
        var r = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, password: password }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          box.textContent = data.error || "Could not sign in.";
          box.classList.add("is-visible");
          return;
        }
        window.location.href = data.isAdmin ? "/overview.html" : "/demo.html";
      } catch (ex) {
        box.textContent =
          "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
        box.classList.add("is-visible");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Sign in";
        }
      }
    });
  }

  function bindRegisterForm() {
    var form = document.getElementById("register-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var box = document.getElementById("register-error");
      box.classList.remove("is-visible");
      box.textContent = "";
      try {
        sessionStorage.removeItem("regPendingVerifyEmail");
      } catch (err) {
        /* ignore */
      }

      var a = document.getElementById("reg-password").value;
      var b = document.getElementById("reg-password2").value;
      if (a !== b) {
        box.textContent = "Passwords do not match.";
        box.classList.add("is-visible");
        return;
      }

      var email = document.getElementById("reg-email").value.trim();
      var name = document.getElementById("reg-name").value.trim();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Creating account…";
      }
      try {
        var r = await fetch("/api/auth/register", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email,
            password: a,
            name: name || null,
          }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          box.textContent = data.error || "Could not register.";
          box.classList.add("is-visible");
          return;
        }
        var verifiedEmail = (
          (data.email && String(data.email).trim()) ||
          email ||
          ""
        ).toLowerCase();
        try {
          sessionStorage.setItem("regPendingVerifyEmail", verifiedEmail);
        } catch (err) {
          /* ignore private mode / blocked storage */
        }
        window.location.href =
          "/registration-complete.html?verify=pending&sent=email&email=" +
          encodeURIComponent(verifiedEmail);
      } catch (ex) {
        box.textContent =
          "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
        box.classList.add("is-visible");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Create account";
        }
      }
    });
  }

  function bindForgotPasswordForm() {
    var form = document.getElementById("forgot-password-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = document.getElementById("forgot-error");
      var okBox = document.getElementById("forgot-success");
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var btn = form.querySelector('button[type="submit"]');
      var email = document.getElementById("forgot-email").value.trim();
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Sending…";
      }

      try {
        var r = await fetch("/api/auth/forgot-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (errBox) {
            errBox.textContent = data.error || "Could not send email.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        if (okBox) {
          okBox.textContent =
            data.message || "If that email is registered, you will receive reset instructions shortly.";
          okBox.hidden = false;
        }
        form.reset();
      } catch (ex) {
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Send reset email";
        }
      }
    });
  }

  function bindResetPasswordForm() {
    var form = document.getElementById("reset-password-form");
    if (!form) return;

    var missing = document.getElementById("reset-token-missing");
    var tokenInput = document.getElementById("reset-token");
    var params = new URLSearchParams(window.location.search);
    var t = params.get("token") || "";
    if (tokenInput) tokenInput.value = t;

    if (!t) {
      if (missing) {
        missing.hidden = false;
        missing.classList.add("is-visible");
      }
      return;
    }

    if (missing) {
      missing.hidden = true;
      missing.classList.remove("is-visible");
    }
    form.hidden = false;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var box = document.getElementById("reset-error");
      if (box) {
        box.classList.remove("is-visible");
        box.textContent = "";
      }

      var a = document.getElementById("reset-password1").value;
      var b = document.getElementById("reset-password2").value;
      if (a !== b) {
        if (box) {
          box.textContent = "Passwords do not match.";
          box.classList.add("is-visible");
        }
        return;
      }

      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Saving…";
      }

      try {
        var r = await fetch("/api/auth/reset-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: t, password: a }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (box) {
            box.textContent = data.error || "Could not reset password.";
            box.classList.add("is-visible");
          }
          return;
        }
        window.location.href = "/login.html?reset=ok";
      } catch (ex) {
        if (box) {
          box.textContent =
            "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
          box.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Update password";
        }
      }
    });
  }

  function bindVerifyEmailPage() {
    var loading = document.getElementById("verify-loading");
    var errBox = document.getElementById("verify-error");
    var okEl = document.getElementById("verify-success");
    var footer = document.getElementById("verify-footer");
    if (!loading) return;

    var params = new URLSearchParams(window.location.search);
    var token = params.get("token") || "";

    if (!token) {
      loading.hidden = true;
      if (errBox) {
        errBox.textContent =
          "Missing verification token. Use the link from your email or request a new one.";
        errBox.classList.add("is-visible");
      }
      if (footer) footer.hidden = false;
      return;
    }

    fetch("/api/auth/verify-email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        loading.hidden = true;
        if (!res.ok) {
          if (errBox) {
            errBox.textContent =
              (res.data && res.data.error) || "Verification failed. Try resending the email.";
            errBox.classList.add("is-visible");
          }
          if (footer) footer.hidden = false;
          return;
        }
        if (okEl) okEl.hidden = false;
        window.location.href = "/demo.html";
      })
      .catch(function () {
        loading.hidden = true;
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
          errBox.classList.add("is-visible");
        }
        if (footer) footer.hidden = false;
      });
  }

  function bindResendVerificationForm() {
    var form = document.getElementById("resend-verification-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = document.getElementById("resend-verify-error");
      var okBox = document.getElementById("resend-verify-success");
      if (errBox) {
        errBox.classList.remove("is-visible");
        errBox.textContent = "";
      }
      if (okBox) {
        okBox.hidden = true;
        okBox.textContent = "";
      }

      var btn = form.querySelector('button[type="submit"]');
      var email = document.getElementById("resend-verify-email").value.trim();
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Sending…";
      }

      try {
        var r = await fetch("/api/auth/resend-verification", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (errBox) {
            errBox.textContent = data.error || "Could not send.";
            errBox.classList.add("is-visible");
          }
          return;
        }
        if (okBox) {
          okBox.textContent =
            data.message ||
            "If an unverified account exists for that address, we sent a new verification code.";
          okBox.hidden = false;
        }
        form.reset();
      } catch (ex) {
        if (errBox) {
          errBox.textContent =
            "Cannot reach the API — use http://localhost:3000 (not file://) with the server running.";
          errBox.classList.add("is-visible");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Send code again";
        }
      }
    });
  }

  function bindRegistrationVerifyPendingPage(searchParams) {
    var emailFromUrl = (searchParams.get("email") || "").trim();
    var emailDisp = document.getElementById("reg-verify-email-display");
    var emailLine = document.getElementById("reg-verify-email-line");
    var emailFallback = document.getElementById("reg-verify-email-fallback");
    var emailInput = document.getElementById("reg-verify-email-input");
    var bannerErr = document.getElementById("reg-verify-banner-error");
    var sendOk = document.getElementById("reg-verify-send-success");
    var sendBtn = document.getElementById("reg-verify-send-btn");
    var smsBlock = document.getElementById("reg-verify-sms-block");
    var phoneEl = document.getElementById("reg-verify-phone");
    var codeForm = document.getElementById("reg-verify-code-form");
    var codeErr = document.getElementById("reg-verify-code-error");
    var codeInput = document.getElementById("reg-verify-code");

    if (!sendBtn || !codeForm || !emailDisp) return;

    function resolvedEmail() {
      var u = emailFromUrl;
      if (u) return u;
      if (emailInput) return emailInput.value.trim().toLowerCase();
      return "";
    }

    if (!emailFromUrl) {
      if (emailLine) emailLine.hidden = true;
      if (emailFallback) emailFallback.hidden = false;
      emailDisp.textContent = "";
    } else {
      emailDisp.textContent = emailFromUrl;
      if (emailLine) emailLine.hidden = false;
      if (emailFallback) emailFallback.hidden = true;
    }

    function channelValue() {
      var r = document.querySelector('input[name="reg-verify-channel"]:checked');
      return r ? r.value : "email";
    }

    function syncSmsVisibility() {
      if (!smsBlock) return;
      smsBlock.hidden = channelValue() !== "sms";
    }

    document.querySelectorAll('input[name="reg-verify-channel"]').forEach(function (el) {
      el.addEventListener("change", syncSmsVisibility);
    });
    syncSmsVisibility();

    if (
      sendOk &&
      String(searchParams.get("sent") || "")
        .toLowerCase() === "email"
    ) {
      sendOk.textContent =
        "We emailed a 6-digit code to your address. Enter it below (or use “Send code” to get a fresh one after ~1 minute).";
      sendOk.hidden = false;
    }

    sendBtn.addEventListener("click", async function () {
      if (bannerErr) {
        bannerErr.classList.remove("is-visible");
        bannerErr.textContent = "";
      }
      if (sendOk) {
        sendOk.hidden = true;
        sendOk.textContent = "";
      }
      var email = resolvedEmail();
      if (!email) {
        if (bannerErr) {
          bannerErr.textContent =
            "Enter the email you used to register (above), then tap Send code.";
          bannerErr.classList.add("is-visible");
        }
        return;
      }
      var ch = channelValue();
      var body = { email: email, channel: ch };
      if (ch === "sms" && phoneEl) {
        body.phone = phoneEl.value.trim();
      }
      sendBtn.disabled = true;
      var prev = sendBtn.textContent;
      sendBtn.textContent = "Sending…";
      try {
        var r = await fetch("/api/auth/send-registration-code", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        var data = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) {
          if (bannerErr) {
            bannerErr.textContent = data.error || "Could not send code.";
            bannerErr.classList.add("is-visible");
          }
          return;
        }
        if (sendOk) {
          sendOk.textContent = data.message || "Code sent.";
          sendOk.hidden = false;
        }
      } catch (ex) {
        if (bannerErr) {
          bannerErr.textContent =
            "Cannot reach the API — use the live site URL with the server running.";
          bannerErr.classList.add("is-visible");
        }
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = prev || "Send code";
      }
    });

    codeForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (codeErr) {
        codeErr.classList.remove("is-visible");
        codeErr.textContent = "";
      }
      var email = resolvedEmail();
      if (!email) {
        if (codeErr) {
          codeErr.textContent =
            "Enter the signup email in the field above (if shown), then request or enter your code.";
          codeErr.classList.add("is-visible");
        }
        return;
      }
      var raw = codeInput ? codeInput.value : "";
      var digits = String(raw).replace(/\D/g, "");
      if (digits.length !== 6) {
        if (codeErr) {
          codeErr.textContent = "Enter the 6-digit code.";
          codeErr.classList.add("is-visible");
        }
        return;
      }
      var submitBtn = codeForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.label = submitBtn.textContent;
        submitBtn.textContent = "Verifying…";
      }
      try {
        var r2 = await fetch("/api/auth/verify-registration-code", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, code: digits }),
        });
        var data2 = await r2.json().catch(function () {
          return {};
        });
        if (!r2.ok) {
          if (codeErr) {
            codeErr.textContent = data2.error || "Verification failed.";
            codeErr.classList.add("is-visible");
          }
          return;
        }
        try {
          sessionStorage.removeItem("regPendingVerifyEmail");
        } catch (err2) {
          /* ignore */
        }
        window.location.href = "/demo.html";
      } catch (ex2) {
        if (codeErr) {
          codeErr.textContent =
            "Cannot reach the API — use the live site URL with the server running.";
          codeErr.classList.add("is-visible");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.label || "Verify and continue";
        }
      }
    });
  }

  function initRegistrationCompletePanels() {
    var pending = document.getElementById("reg-complete-verify-pending");
    var def = document.getElementById("reg-complete-default");
    if (!pending || !def) return;
    var params = new URLSearchParams(window.location.search);
    var stored = "";
    try {
      stored = (sessionStorage.getItem("regPendingVerifyEmail") || "").trim();
    } catch (e) {
      stored = "";
    }

    function openVerifyFlow(p) {
      pending.hidden = false;
      def.hidden = true;
      bindRegistrationVerifyPendingPage(p);
    }

    if (params.get("verify") === "pending") {
      openVerifyFlow(params);
      return;
    }
    if (stored) {
      var fallback = new URLSearchParams();
      fallback.set("email", stored);
      openVerifyFlow(fallback);
    }
  }

  async function syncNav() {
    var nav = document.querySelector("[data-site-nav]");
    if (!nav) return;

    var guest = nav.querySelector(".nav-auth-guest");
    var user = nav.querySelector(".nav-auth-user");
    var authItems = nav.querySelectorAll("[data-requires-auth]");
    var authAnyItems = nav.querySelectorAll("[data-requires-auth-any]");
    var authRegularItems = nav.querySelectorAll("[data-requires-auth-regular]");
    var adminItems = nav.querySelectorAll("[data-requires-admin]");
    var me = null;
    try {
      var r = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (r.ok) {
        me = await r.json();
      }
    } catch (e) {
      /* API not running or opened as file:// */
    }

    var loggedIn = me && me.loggedIn === true;
    var isAdmin = me && me.isAdmin === true;

    var nameEl = document.getElementById("nav-user-display-name");
    if (nameEl) {
      if (loggedIn && me.user) {
        var u = me.user;
        var disp =
          (u.name && String(u.name).trim()) ||
          (u.email && String(u.email).trim()) ||
          "";
        nameEl.textContent = disp || "Signed in";
      } else {
        nameEl.textContent = "";
      }
    }

    if (guest) guest.hidden = loggedIn;
    if (user) user.hidden = !loggedIn;
    authItems.forEach(function (el) {
      el.hidden = !loggedIn;
    });
    authAnyItems.forEach(function (el) {
      el.hidden = !loggedIn;
    });
    authRegularItems.forEach(function (el) {
      el.hidden = !loggedIn || isAdmin;
    });
    adminItems.forEach(function (el) {
      el.hidden = !isAdmin;
    });

    var logoutBtn = document.getElementById("nav-logout");
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = "1";
      logoutBtn.addEventListener("click", async function () {
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        } catch (e) {
          /* ignore */
        }
        window.location.replace("/demo.html");
      });
    }
  }

  function init() {
    showQueryParamErrors();
    bindLoginForm();
    bindRegisterForm();
    bindForgotPasswordForm();
    bindResetPasswordForm();
    bindVerifyEmailPage();
    bindResendVerificationForm();
    bindContactForm();
    bindRecruitmentForm();
    initRegistrationCompletePanels();
    syncNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
