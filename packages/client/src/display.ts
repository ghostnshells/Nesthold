/** Render at device resolution (capped for performance) so art stays crisp on Retina screens. */
export const DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

/** Canvas text is rasterised once, then zoomed with the camera: oversample it to stay crisp. */
export const TEXT_RES = Math.ceil(DPR * 1.5);
