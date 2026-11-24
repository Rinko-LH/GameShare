const sources = new Map();
const colors = ['#154f79', '#855138', '#3c6c49'];
const frameInterval = 1000 / 30;

self.onmessage = ({ data: { index, output, stop } }) => {
  if (stop) {
    sources.get(index)?.();
    sources.delete(index);
    return;
  }
  const writer = output.getWriter();
  const canvas = new OffscreenCanvas(640, 360);
  const context = canvas.getContext('2d', { alpha: false });
  const start = performance.now();
  let frame = 0;
  let pending = false;

  // 在 Worker 生成视频帧，避免被主窗口的渲染回调绑定到窗口可见性。
  const timer = setInterval(async () => {
    if (pending) return;
    pending = true;
    const elapsed = performance.now() - start;
    context.fillStyle = colors[index];
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#ffffff';
    context.fillRect((elapsed / 4) % 600, 225, 40, 25);
    context.font = 'bold 54px "Segoe UI", sans-serif';
    context.fillText(`#${index + 1}   ${(elapsed / 1000).toFixed(2)} s`, 36, 150);
    context.font = '25px "Segoe UI", sans-serif';
    context.fillText(`WebRTC   •   ${++frame}`, 36, 192);
    const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
    try {
      await writer.write(videoFrame);
    } catch (error) {
      clearInterval(timer);
      if (sources.has(index)) self.postMessage(String(error));
    } finally {
      videoFrame.close();
      pending = false;
    }
  }, frameInterval);
  sources.set(index, () => {
    clearInterval(timer);
    void writer.close().catch(() => undefined);
  });
};
