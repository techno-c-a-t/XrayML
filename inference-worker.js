/**
 * inference-worker.js
 * Выделенный воркер ядра CPU для параллельного инференса срезов YOLO11.
 * 1 воркер = 1 выделенное физическое ядро (intraOpNumThreads: 1, WASM SIMD).
 * Десатурация, нормализация тензора и инференс ONNX выполняются полностью внутри воркера.
 */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.all.min.js');

let session = null;
let workerId = -1;
let baseRgba = null;

function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA.x1, boxB.x1);
  const yA = Math.max(boxA.y1, boxB.y1);
  const xB = Math.min(boxA.x2, boxB.x2);
  const yB = Math.min(boxA.y2, boxB.y2);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = boxA.width * boxA.height;
  const boxBArea = boxB.width * boxB.height;
  const unionArea = boxAArea + boxBArea - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function applyNMS(boxes, iouThreshold = 0.45) {
  if (boxes.length === 0) return [];
  boxes.sort((a, b) => b.conf - a.conf);

  const selected = [];
  const active = new Array(boxes.length).fill(true);

  for (let i = 0; i < boxes.length; i++) {
    if (!active[i]) continue;
    const bA = boxes[i];
    selected.push(bA);

    for (let j = i + 1; j < boxes.length; j++) {
      if (!active[j]) continue;
      const bB = boxes[j];
      if (calculateIoU(bA, bB) > iouThreshold) {
        active[j] = false;
      }
    }
  }

  return selected;
}

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    workerId = payload.workerId;
    try {
      if (self.ort && self.ort.env && self.ort.env.wasm) {
        self.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
        self.ort.env.wasm.numThreads = 1;
        self.ort.env.wasm.simd = true;
      }
      const modelInput = payload.modelBuffer
        ? new Uint8Array(payload.modelBuffer)
        : payload.modelPath;
      session = await self.ort.InferenceSession.create(modelInput, {
        executionProviders: ['wasm']
      });
      self.postMessage({ type: 'ready', workerId });
    } catch (err) {
      self.postMessage({ type: 'error', workerId, error: err.message || String(err) });
    }
  } else if (type === 'set_base') {
    baseRgba = payload.baseRgba;
    self.postMessage({ type: 'base_set', workerId });
  } else if (type === 'run_sweep') {
    const { sweepIndex, k, meta, dstSize } = payload;
    let tensor = null;
    let outputTensor = null;
    try {
      self.postMessage({ type: 'busy', workerId, sweepIndex, k });

      // 1. Быстрая десатурация + формирование Float32 CHW тензора в выделенном потоке воркера
      const tPrep0 = performance.now();
      const area = dstSize * dstSize;
      const inv255 = 1.0 / 255.0;
      const floatArr = new Float32Array(3 * area);

      const src = baseRgba;
      for (let p = 0; p < area; p++) {
        const p4 = p * 4;
        const r = src[p4];
        const g = src[p4 + 1];
        const b = src[p4 + 2];
        const mean = (r + g + b) / 3.0;

        const satR = Math.min(255, Math.max(0, mean + k * (r - mean)));
        const satG = Math.min(255, Math.max(0, mean + k * (g - mean)));
        const satB = Math.min(255, Math.max(0, mean + k * (b - mean)));

        floatArr[p] = satR * inv255;
        floatArr[area + p] = satG * inv255;
        floatArr[area * 2 + p] = satB * inv255;
      }
      const prepMs = performance.now() - tPrep0;

      // 2. Инференс ONNX
      const tInfer0 = performance.now();
      tensor = new self.ort.Tensor('float32', floatArr, [1, 3, dstSize, dstSize]);
      const feeds = {};
      feeds[session.inputNames[0]] = tensor;
      const results = await session.run(feeds);
      const inferMs = performance.now() - tInfer0;

      // 3. Декодирование боксов из 8400 анкоров
      outputTensor = results[session.outputNames[0]];
      const data = outputTensor.data;
      const [, , numBoxes] = outputTensor.dims;
      const confThreshold = payload.confThreshold !== undefined ? payload.confThreshold : 0.15;

      const rawBoxes = [];
      let maxRawConf = 0;
      for (let b = 0; b < numBoxes; b++) {
        const conf = data[4 * numBoxes + b];
        if (conf > maxRawConf) maxRawConf = conf;
        if (conf >= confThreshold) {
          const cx = data[0 * numBoxes + b];
          const cy = data[1 * numBoxes + b];
          const bw = data[2 * numBoxes + b];
          const bh = data[3 * numBoxes + b];
          const x1 = Math.max(0, (cx - bw / 2 - meta.padX) / meta.scale);
          const y1 = Math.max(0, (cy - bh / 2 - meta.padY) / meta.scale);
          const x2 = Math.min(meta.srcW, (cx + bw / 2 - meta.padX) / meta.scale);
          const y2 = Math.min(meta.srcH, (cy + bh / 2 - meta.padY) / meta.scale);
          rawBoxes.push({
            x1, y1, x2, y2,
            width: x2 - x1,
            height: y2 - y1,
            conf,
            classId: 0,
            label: 'Gun',
            sweepIndex,
            kSat: k
          });
        }
      }

      // NMS внутри одного кадра: отсекаем дублирующие соседние анкоры для одного объекта
      const nmsIou = payload.nmsIouThreshold !== undefined ? payload.nmsIouThreshold : 0.45;
      const finalBoxes = applyNMS(rawBoxes, nmsIou);

      self.postMessage({
        type: 'sweep_done',
        workerId,
        sweepIndex,
        k,
        prepMs: Math.round(prepMs),
        inferMs: Math.round(inferMs),
        totalMs: Math.round(prepMs + inferMs),
        maxRawConf,
        boxes: finalBoxes
      });
      self.postMessage({ type: 'idle', workerId });
    } catch (err) {
      self.postMessage({ type: 'sweep_error', workerId, sweepIndex, error: err.message || String(err) });
      self.postMessage({ type: 'idle', workerId });
    } finally {
      tensor?.dispose?.();
      outputTensor?.dispose?.();
    }
  }
};
