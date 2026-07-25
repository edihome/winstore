/**
 * ============================================================
 * File: image.js
 * Module: Shared Utilities
 *
 * Description:
 * Resize an uploaded image in the browser to a small PNG data URI —
 * used for the organization receipt logo and each user's passport
 * photo. Keeping images small (a capped dimension) means they store
 * inline as a data URI without a file-storage backend and print/render
 * crisply at avatar/receipt size.
 * ============================================================
 */

/**
 * @param {File} file The uploaded image file.
 * @param {number} maxSize Longest edge, in px, of the result.
 * @returns {Promise<string>} A PNG data URI.
 */
export const resizeToDataUri = (file, maxSize = 320) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a valid image."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
