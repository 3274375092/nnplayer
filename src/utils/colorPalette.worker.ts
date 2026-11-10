/// <reference lib="webworker" />
// 封面取色 Worker：在后台线程完成封面下载、解码与 112×112 采样，主线程只
// 接收最终的种子色/辅助色。图片解码与 getImageData 是切歌时最容易造成
// 主线程长帧的工作；搬到 Worker 后主线程只付一次 postMessage 的成本。
//
// 通过 Vite 的 `new Worker(new URL(..., import.meta.url), { type: "module" })`
// 引入；不支持 module worker 的环境会构造失败，调用方回退主线程实现。

import { extractPaletteFromRgba } from "./colorPalette";

interface PaletteRequest {
  id: number;
  url: string;
  sampleSize: number;
}

interface PaletteSuccess {
  id: number;
  palette: { seed: string; palette: string[] };
}

interface PaletteFailure {
  id: number;
  error: string;
}

function handleRequest(request: PaletteRequest) {
  const { id, url, sampleSize } = request;
  void (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`封面请求失败: ${response.status}`);
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = new OffscreenCanvas(sampleSize, sampleSize);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("OffscreenCanvas 2d context 不可用");
        context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
        const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
        const success: PaletteSuccess = {
          id,
          palette: extractPaletteFromRgba(pixels),
        };
        self.postMessage(success);
      } finally {
        // 解码位图显式释放：OffscreenCanvas/getImageData 失败时也不能等 GC。
        bitmap.close();
      }
    } catch (error) {
      const failure: PaletteFailure = {
        id,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(failure);
    }
  })();
}

self.onmessage = (event: MessageEvent<PaletteRequest>) => {
  handleRequest(event.data);
};
