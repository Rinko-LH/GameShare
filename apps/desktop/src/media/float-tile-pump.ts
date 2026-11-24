type FrameSize = { width: number; height: number };

// 当前 Electron 的 Chromium 在 Window 上提供此 API，TypeScript 的 DOM 类型未声明它。
type TrackProcessor = new (options: {
  track: MediaStreamTrack;
  maxBufferSize: number;
}) => { readable: ReadableStream<VideoFrame> };

export function startFloatTilePump(
  track: MediaStreamTrack,
  port: MessagePort,
  getSize: () => FrameSize | undefined,
  onError: (error: unknown) => void,
): () => void {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return () => undefined;

  const { MediaStreamTrackProcessor } = window as Window & {
    MediaStreamTrackProcessor?: TrackProcessor;
  };
  if (!MediaStreamTrackProcessor) {
    onError(new Error('MediaStreamTrackProcessor is unavailable'));
    return () => undefined;
  }

  // 直接消费视频轨道，最小化主窗口时也无需等待 <video> 向合成器提交帧。
  // 每次只转换一帧，转换期间由处理器保留最新的一帧，避免积压。
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
  let stopped = false;

  async function pump(ctx: CanvasRenderingContext2D): Promise<void> {
    try {
      while (!stopped) {
        const { done, value: frame } = await reader.read();
        if (done) break;

        try {
          if (stopped) break;
          const srcW = frame.displayWidth;
          const srcH = frame.displayHeight;
          const box = getSize() ?? { width: srcW, height: srcH };
          const scale = Math.min(box.width / srcW, box.height / srcH, 1);
          const width = Math.max(1, Math.round(srcW * scale));
          const height = Math.max(1, Math.round(srcH * scale));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          ctx.drawImage(frame, 0, 0, width, height);
        } finally {
          frame.close();
        }

        const bitmap = await createImageBitmap(canvas);
        if (stopped) {
          bitmap.close();
          break;
        }
        try {
          port.postMessage({ bmp: bitmap }, [bitmap]);
        } catch (error) {
          bitmap.close();
          throw error;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  void pump(context).catch((error: unknown) => {
    if (!stopped) onError(error);
  });

  function stop(): void {
    stopped = true;
    // 取消读取不会停止 WebRTC 轨道。轨道仍由会话管理。
    void reader.cancel().catch(() => undefined);
  }

  return stop;
}
