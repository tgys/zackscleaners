"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { pool } = require("./db");
const { notifyInboxChanged } = require("./adminMessagesRealtime");
const {
  EMAIL_RE,
  NAME_CTRL_RE,
  trimStr,
  validatePhone,
  createHourlyIpLimiter,
} = require("./inputValidators");

const router = express.Router();

/** Typical single-page text CV; tuned conservative vs multi-page/image-heavy PDFs. */
const CV_MAX_BYTES = 1024 * 1024;

const REC_DIR =
  process.env.RECRUITMENT_CV_DIR ||
  path.join(__dirname, "..", "data", "recruitment-cvs");

fs.mkdirSync(REC_DIR, { recursive: true });

const recruitmentRateLimit = createHourlyIpLimiter(12);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, REC_DIR);
  },
  filename(_req, _file, cb) {
    cb(null, `${crypto.randomUUID()}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CV_MAX_BYTES, files: 1, fields: 12, parts: 24 },
  fileFilter(_req, file, cb) {
    const lower = (file.originalname || "").toLowerCase();
    if (!lower.endsWith(".pdf")) {
      return cb(new Error("Please upload a PDF file (.pdf)."));
    }
    const mt = (file.mimetype || "").toLowerCase();
    const okMime =
      mt === "" ||
      mt === "application/pdf" ||
      mt === "application/x-pdf" ||
      mt === "binary/octet-stream" ||
      mt === "application/octet-stream";
    if (!okMime) {
      return cb(new Error("File must be a PDF."));
    }
    cb(null, true);
  },
});

function sanitizeOriginalFilename(name) {
  const base = path.basename(String(name || "")).replace(/[\x00-\x1f\x7f]/g, "");
  let s = base.slice(0, 200);
  if (!/\.pdf$/i.test(s)) s = `${s.replace(/\./g, "_")}.pdf`;
  return s || "cv.pdf";
}

async function fileStartsWithPdfMagic(filePath) {
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return buf.toString("latin1") === "%PDF";
  } finally {
    await fh.close();
  }
}

function handleCvUpload(req, res, next) {
  upload.single("cv")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `CV must be a PDF under ${CV_MAX_BYTES / (1024 * 1024)} MB (about one page).`,
        });
      }
      return res.status(400).json({ error: "Upload failed." });
    }
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    next();
  });
}

router.post("/", recruitmentRateLimit, handleCvUpload, async (req, res) => {
  const email = trimStr(req.body && req.body.email, 320);
  const name = trimStr(req.body && req.body.name, 200);
  const address = trimStr(req.body && req.body.address, 4000);

  const phonePrefix =
    req.body && req.body.phonePrefix != null ? String(req.body.phonePrefix).trim() : "";
  const phoneNationalRaw = req.body && req.body.phoneNational != null ? req.body.phoneNational : "";

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Please attach your CV as a PDF." });
  }

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    await fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (!name || NAME_CTRL_RE.test(name)) {
    await fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: "Please enter your name (no control characters)." });
  }
  if (!address || NAME_CTRL_RE.test(address)) {
    await fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({
      error: "Please enter your full address including postcode (no control characters).",
    });
  }

  const phoneCheck = validatePhone(phonePrefix, phoneNationalRaw);
  if (!phoneCheck.ok) {
    await fs.promises.unlink(file.path).catch(() => {});
    const suffix = phoneCheck.hint ? ` ${phoneCheck.hint}` : "";
    return res.status(400).json({
      error: `Invalid mobile number for the selected country code.${suffix}`,
    });
  }
  const mobile = phoneCheck.mobile;
  if (mobile.length > 24) {
    await fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: "Phone number is too long." });
  }

  let pdfOk = false;
  try {
    pdfOk = await fileStartsWithPdfMagic(file.path);
  } catch (e) {
    console.error(e);
  }
  if (!pdfOk) {
    await fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: "File must be a valid PDF." });
  }

  const cvOriginal = sanitizeOriginalFilename(file.originalname);
  const cvStored = file.filename;

  try {
    const r = await pool.query(
      `
      INSERT INTO recruitment_applications (
        email, name, address, mobile, cv_stored_filename, cv_original_name
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
    `,
      [email, name, address, mobile, cvStored, cvOriginal],
    );
    notifyInboxChanged();
    res.status(201).json({
      ok: true,
      application: r.rows[0],
    });
  } catch (err) {
    console.error(err);
    await fs.promises.unlink(file.path).catch(() => {});
    res.status(500).json({ error: "Could not save your application. Please try again later." });
  }
});

module.exports = { router, CV_MAX_BYTES, REC_DIR };
