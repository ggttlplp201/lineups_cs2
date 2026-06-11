'use strict';
/* Radar vision capture loop (V2 in-match position, experimental).
   Captures the screen, crops the radar region, finds the white player
   arrow, ships the pixel to main. Detection itself is pure and lives in
   ../vision/radar.js (shared with the unit tests). Enabled via
   config.json → vision.enabled. */
(function () {
  let started = false;
  let last = null; // last arrow pixel, for continuity bias

  window.overlay.onInit(({ vision }) => {
    if (started || !vision || !vision.enabled) return;
    started = true;
    start(vision).catch((err) => console.error(`vision: ${err.message}`));
  });

  async function start(cfg) {
    const sourceId = await window.overlay.getVisionSource();
    if (!sourceId) throw new Error('no screen source available');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();

    const r = cfg.region;
    const canvas = document.createElement('canvas');
    canvas.width = r.width;
    canvas.height = r.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    setInterval(() => {
      if (video.videoWidth === 0) return; // stream not delivering yet
      ctx.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      const img = ctx.getImageData(0, 0, r.width, r.height);
      const arrow = window.RadarVision.findArrow(img, { near: last });
      if (arrow) {
        last = { px: arrow.px, py: arrow.py };
        window.overlay.sendArrowPixel(arrow);
      }
    }, Math.max(100, 1000 / (cfg.fps || 2)));
  }
})();
