/**
 * ============================================================
 * File: upload.js
 * Module: Middlewares
 *
 * Description:
 * Single .xlsx file upload for bulk-import routes. Memory storage —
 * files are parsed immediately by exceljs and never touch disk, so
 * there's nothing to clean up and nothing to leak between requests.
 * ============================================================
 */

const multer = require("multer");
const AppError = require("../utils/AppError");

const ALLOWED_MIME_TYPES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
];

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — a bulk-import spreadsheet has no business being bigger.

const multerUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(new AppError("Only .xlsx files are accepted.", 400));
        }
        return cb(null, true);
    },
});

/**
 * Wraps multer's .single("file") so its own errors (file too large,
 * wrong field name, wrong file type) come back as a normal 400 through
 * the app's error handler instead of an unhandled 500.
 */
const uploadSingleFile = (req, res, next) => {
    multerUpload.single("file")(req, res, (error) => {
        if (error instanceof multer.MulterError) {
            return next(new AppError(error.message, 400));
        }
        if (error) {
            return next(error);
        }
        return next();
    });
};

module.exports = { uploadSingleFile };
