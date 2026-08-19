/**
 * Centralized photo-upload configuration.
 *
 * Photo upload UI/implementation is still a future phase (see DEVIN.md
 * "Photos" / "Implementation Sequence") — this file exists now, ahead of
 * that work, because government specifically raised cellular-data usage
 * as a launch concern (see PRODUCT.md "Photo Cellular-Data
 * Requirements"). Any future property-photo or proof-of-delivery
 * implementation MUST read these values rather than hard-coding
 * compression numbers, and must resize/compress images CLIENT-SIDE
 * before upload — never upload an original full-resolution phone photo.
 *
 * Do not hard-code these numbers anywhere else in the application. If a
 * value needs to change (e.g. after real-world testing of delivery
 * photo legibility vs. data usage on Saba's cellular network), change
 * it here.
 */
export const photoUploadConfig = {
  /**
   * Maximum long-dimension (px) after client-side resizing. Chosen to
   * remain legible for identifying a house, cistern, access point, or
   * proof of delivery — this is delivery documentation, not archival
   * photography (see PRODUCT.md "Photo Cellular-Data Requirements").
   */
  maxLongDimensionPx: 1600,

  /** Client-side re-encode format. WebP is preferred where the browser
   * supports encoding it; JPEG is the universal fallback. */
  preferredFormat: "webp" as const,
  fallbackFormat: "jpeg" as const,

  /** Compression quality (0-1) for the re-encoded image. */
  quality: 0.75,

  /**
   * Hard client-side ceiling on the COMPRESSED upload size, in bytes.
   * If compression cannot bring an image under this size, the upload
   * must fail with a clear error rather than uploading a larger file —
   * see PRODUCT.md "Photo Failure Testing Requirements" ("do not allow
   * repeated retries to silently consume excessive cellular data").
   */
  maxCompressedBytes: 1_500_000,

  /** Maximum number of photos a single upload flow may queue at once
   * (property photos or proof-of-delivery), to bound worst-case
   * cellular data and browser memory usage per action. */
  maxPhotosPerUpload: 6,

  /**
   * EXIF/metadata handling: orientation must be applied (baked into
   * the re-encoded pixels) before other metadata is stripped, so a
   * compressed photo never displays sideways/upside-down. All other
   * EXIF (GPS, device info, timestamps) should be stripped — see
   * PRODUCT.md "Photo Privacy" ("no personal data in filenames") and
   * "Photo Cellular-Data Requirements".
   */
  stripMetadataExceptOrientation: true,
} as const;

export type PhotoUploadConfig = typeof photoUploadConfig;
