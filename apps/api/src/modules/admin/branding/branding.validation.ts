/// TASK 14.5A: content-type validation for the business-logo upload.
///
/// TASK 16.6 — this logic is now shared: the real implementation lives in
/// `apps/api/src/http/image-upload-validation.ts` (generalized so the
/// product-image upload reuses it too, rather than a hand-copied
/// duplicate). This file re-exports the same functions/constants under
/// their original "Logo"-named identifiers so every existing caller/test
/// of this module is untouched — a pure rename-at-the-boundary, zero
/// behavior change.
export {
  ALLOWED_IMAGE_CONTENT_TYPES as ALLOWED_LOGO_CONTENT_TYPES,
  MAX_IMAGE_BYTES as MAX_LOGO_BYTES,
  isAllowedImageContentType as isAllowedLogoContentType,
  imageFileExtension as logoFileExtension,
  matchesImageFileSignature as matchesLogoFileSignature,
  type AllowedImageContentType as AllowedLogoContentType,
} from '../../../http/image-upload-validation.js';
