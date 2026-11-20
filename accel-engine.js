/**
 * accel-engine.js
 * Движок адаптивного ускорения инференса:
 * - Генератор равномерной сетки k_sat с отступами от краёв ([margin .. 1 - margin], шаг 0.05)
 * - WebGPU-роутер с калибровкой устройства и проверкой численного паритета GPU vs WASM
 * - Адаптивный батчинг (batch=2 -> batch=4 -> откат на batch=2 -> WASM fallback)
 * - Поддержка кэшированного ArrayBuffer модели, AbortSignal, dispose() и прогресса по батчам
 */

import { XrayNormalizer } from './xray-normalizer.js?v=9';

const CALIB_STORAGE_KEY = 'xray_accel_profile_v2';

export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function getOptimalWasmWorkerCount() {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, cores - 1);
}

/**
 * Генератор равномерного распределения k_sat с отступом margin с каждой стороны.
 * По умолчанию: [0.10 .. 0.90] с шагом 0.05 -> 17 кадров.
 */
export function generateKSweepGrid({ margin = 0.10, step = 0.05, minFrames = 2, maxFrames = 60 } = {}) {
  const m = Math.min(0.45, Math.max(0.0, margin));
  const s = Math.max(0.01, step);
  const start = m;
  const end = 1.0 - m;
  const span = Math.max(0, end - start);

  let count = Math.floor(span / s + 1e-9) + 1;
  count = Math.max(minFrames, Math.min(maxFrames, count));

  const grid = [];
  if (count === 1) {
    grid.push(parseFloat(((start + end) / 2).toFixed(3)));
    return grid;
  }

  const actualStep = span / (count - 1);
  for (let i = 0; i < count; i++) {
    grid.push(parseFloat((start + i * actualStep).toFixed(3)));
  }
  return grid;
}

export function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA.x1, boxB.x1);
  const yA = Math.max(boxA.y1, boxB.y1);
  const xB = Math.min(boxA.x2, boxB.x2);
  const yB = Math.min(boxA.y2, boxB.y2);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = (boxA.width ?? (boxA.x2 - boxA.x1)) * (boxA.height ?? (boxA.y2 - boxA.y1));
  const boxBArea = (boxB.width ?? (boxB.x2 - boxB.x1)) * (boxB.height ?? (boxB.y2 - boxB.y1));
  const unionArea = boxAArea + boxBArea - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

export function applyNMS(boxes, iouThreshold = 0.45) {
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

export function fuseMultiSpectralBoxes(boxes, iouThreshold = 0.45, minDetections = 2, totalSweeps = 30) {
  if (boxes.length === 0) return [];

  const clusters = [];
  const used = new Array(boxes.length).fill(false);

  for (let i = 0; i < boxes.length; i++) {
    if (used[i]) continue;
    const cluster = [boxes[i]];
    used[i] = true;

    for (let j = i + 1; j < boxes.length; j++) {
      if (used[j]) continue;
      if (calculateIoU(boxes[i], boxes[j]) > iouThreshold) {
        cluster.push(boxes[j]);
        used[j] = true;
      }
    }
    clusters.push(cluster);
  }

  const fusedBoxes = [];
  for (const cluster of clusters) {
    const uniqueSweeps = new Set(cluster.map(b => b.sweepIndex !== undefined ? b.sweepIndex : b.kSat));
    const hitsCount = uniqueSweeps.size;

    if (hitsCount < minDetections) continue;

    let sumConf = 0;
    let sumX1 = 0, sumY1 = 0, sumX2 = 0, sumY2 = 0;
    let maxConf = 0;

    cluster.forEach(b => {
      const w = b.conf;
      sumConf += w;
      sumX1 += b.x1 * w;
      sumY1 += b.y1 * w;
      sumX2 += b.x2 * w;
      sumY2 += b.y2 * w;
      if (b.conf > maxConf) maxConf = b.conf;
    });

    const avgX1 = sumX1 / sumConf;
    const avgY1 = sumY1 / sumConf;
    const avgX2 = sumX2 / sumConf;
    const avgY2 = sumY2 / sumConf;

    fusedBoxes.push({
      x1: avgX1,
      y1: avgY1,
      x2: avgX2,
      y2: avgY2,
      width: avgX2 - avgX1,
      height: avgY2 - avgY1,
      conf: maxConf,
      detectionsCount: hitsCount,
      totalSweeps,
      label: 'Gun'
    });
  }

  fusedBoxes.sort((a, b) => b.conf - a.conf);
  return fusedBoxes;
}

export function buildSingleNormalizedChw(baseRgba, k = 0.42, dstSize = 640) {
  const area = dstSize * dstSize;
  const inv255 = 1.0 / 255.0;
  const out = new Float32Array(3 * area);
  for (let p = 0; p < area; p++) {
    const p4 = p * 4;
    const r = baseRgba[p4];
    const g = baseRgba[p4 + 1];
    const b = baseRgba[p4 + 2];
    const mean = (r + g + b) / 3.0;
    out[p] = Math.min(255, Math.max(0, mean + k * (r - mean))) * inv255;
    out[area + p] = Math.min(255, Math.max(0, mean + k * (g - mean))) * inv255;
    out[area * 2 + p] = Math.min(255, Math.max(0, mean + k * (b - mean))) * inv255;
  }
  return out;
}

export async function loadReferenceChw(sampleUrl = 'samples/image9.png', k = 0.42, dstSize = 640) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = sampleUrl;
  await img.decode();

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  normCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  new XrayNormalizer().prepareBase(normCanvas);

  const sweepCanvas = document.createElement('canvas');
  sweepCanvas.width = dstSize;
  sweepCanvas.height = dstSize;
  const sctx = sweepCanvas.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#727272';
  sctx.fillRect(0, 0, dstSize, dstSize);
  const scale = Math.min(dstSize / w, dstSize / h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  sctx.drawImage(normCanvas, 0, 0, w, h, (dstSize - nw) / 2, (dstSize - nh) / 2, nw, nh);
  const rgba = sctx.getImageData(0, 0, dstSize, dstSize).data;

  return buildSingleNormalizedChw(rgba, k, dstSize);
}

export class WebGPUExecutor {
  constructor(modelPath, modelBuffer = null) {
    this.modelPath = modelPath;
    this.modelBuffer = modelBuffer;
    this.session = null;
    this.batchSize = 2;
    this.optLevel = 'basic';
    this.preferredLayout = 'NCHW';
    this.adapterInfo = 'WebGPU';
    this.isReady = false;
  }

  setModelBuffer(buffer) {
    this.modelBuffer = buffer || null;
  }

  _getModelInput() {
    if (this.modelBuffer instanceof ArrayBuffer && this.modelBuffer.byteLength > 0) {
      return new Uint8Array(this.modelBuffer.slice(0));
    }
    return this.modelPath;
  }

  static getSavedProfile() {
    try {
      const raw = localStorage.getItem(CALIB_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static saveProfile(profile) {
    try {
      localStorage.setItem(CALIB_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // ignore storage quota errors
    }
  }

  static clearSavedProfile() {
    try {
      localStorage.removeItem(CALIB_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  async createSession({ optLevel = this.optLevel, preferredLayout = this.preferredLayout } = {}) {
    if (!window.ort) {
      throw new Error('ONNX Runtime Web не загружен');
    }
    if (window.ort.env?.webgpu) {
      window.ort.env.webgpu.powerPreference = 'high-performance';
    }
    if (this.session && typeof this.session.release === 'function') {
      try {
        await this.session.release();
      } catch {
        // ignore
      }
      this.session = null;
    }

    const epOpt = preferredLayout ? { name: 'webgpu', preferredLayout } : 'webgpu';
    this.session = await window.ort.InferenceSession.create(this._getModelInput(), {
      executionProviders: [epOpt],
      graphOptimizationLevel: optLevel
    });
    this.optLevel = optLevel;
    this.preferredLayout = preferredLayout;
    return this.session;
  }

  _verifyOutputParity(data, dims, wasmRefMaxConf) {
    const [batch, channels, numBoxes] = dims || [0, 0, 0];
    if (!data || data.length === 0 || !batch || !numBoxes) {
      return { ok: false, maxConfs: [], nans: 0, zeroRatio: 1, reason: 'Пустой выходной тензор' };
    }

    let nans = 0;
    let zeros = 0;
    for (let i = 0; i < data.length; i++) {
      if (Number.isNaN(data[i])) nans++;
      else if (data[i] === 0) zeros++;
    }
    const zeroRatio = zeros / data.length;

    if (nans > 0) {
      return { ok: false, maxConfs: [], nans, zeroRatio, reason: `Обнаружено ${nans} NaN в выходе GPU` };
    }
    if (zeroRatio >= 0.50) {
      return { ok: false, maxConfs: [], nans, zeroRatio, reason: `GPU занулил ${(zeroRatio * 100).toFixed(1)}% выхода` };
    }

    const maxConfs = [];
    for (let b = 0; b < batch; b++) {
      const stride = b * channels * numBoxes;
      let maxC = 0;
      for (let i = 0; i < numBoxes; i++) {
        const c = data[stride + 4 * numBoxes + i];
        if (c > maxC) maxC = c;
      }
      maxConfs.push(maxC);
    }

    if (wasmRefMaxConf && wasmRefMaxConf > 0.25) {
      for (let b = 0; b < maxConfs.length; b++) {
        const gMax = maxConfs[b];
        if (gMax < 0.25 || Math.abs(gMax - wasmRefMaxConf) > 0.08) {
          return {
            ok: false,
            maxConfs,
            nans,
            zeroRatio,
            reason: `Расхождение с WASM на батче #${b}: GPU maxConf=${gMax.toFixed(3)} vs WASM=${wasmRefMaxConf.toFixed(3)}`
          };
        }
      }
    }

    return { ok: true, maxConfs, nans, zeroRatio, reason: 'OK' };
  }

  async _runAndCheckBatch(batchSize, refInput1x, wasmRefMaxConf, dstSize = 640) {
    const singleLen = 3 * dstSize * dstSize;
    const buf = new Float32Array(batchSize * singleLen);
    if (refInput1x && refInput1x.length === singleLen) {
      for (let b = 0; b < batchSize; b++) {
        buf.set(refInput1x, b * singleLen);
      }
    }

    const tensor = new window.ort.Tensor('float32', buf, [batchSize, 3, dstSize, dstSize]);
    let outTensor = null;
    try {
      const feeds = { [this.session.inputNames[0]]: tensor };
      const t0 = performance.now();
      const results = await this.session.run(feeds);
      outTensor = results[this.session.outputNames[0]];
      const data = typeof outTensor.getData === 'function'
        ? await outTensor.getData()
        : outTensor.data;
      const elapsed = performance.now() - t0;
      const parity = this._verifyOutputParity(data, outTensor.dims, wasmRefMaxConf);
      return { elapsed, parity };
    } finally {
      tensor.dispose?.();
      outTensor?.dispose?.();
    }
  }

  async calibrate({ onStep, signal, refInput1x = null, wasmRefMaxConf = null, sampleUrl = 'samples/image9.png', t = null } = {}) {
    const msg = (key, fallback, vars = {}) => {
      if (typeof t === 'function') {
        const res = t(key, vars);
        if (res) return res;
      }
      return fallback;
    };
    const report = (pct, text) => {
      if (onStep) onStep(pct, text);
    };
    const checkAbort = () => {
      if (signal && signal.aborted) {
        const err = new Error('Калибровка прервана пользователем');
        err.name = 'AbortError';
        throw err;
      }
    };

    report(8, msg('calibCheckGpu', 'Проверка поддержки WebGPU...'));
    checkAbort();

    if (!navigator.gpu) {
      const profile = { backend: 'wasm', batchSize: 1, reason: 'WebGPU не поддерживается браузером', calibratedAt: Date.now() };
      WebGPUExecutor.saveProfile(profile);
      this.isReady = false;
      return profile;
    }

    let adapter = null;
    try {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch {
      adapter = null;
    }
    checkAbort();

    if (!adapter) {
      const profile = { backend: 'wasm', batchSize: 1, reason: 'GPU-адаптер недоступен (вернул null)', calibratedAt: Date.now() };
      WebGPUExecutor.saveProfile(profile);
      this.isReady = false;
      return profile;
    }

    if (adapter.isFallbackAdapter) {
      const profile = { backend: 'wasm', batchSize: 1, reason: 'Обнаружен программный CPU-эмулятор WebGPU (isFallbackAdapter)', calibratedAt: Date.now() };
      WebGPUExecutor.saveProfile(profile);
      this.isReady = false;
      return profile;
    }

    const maxBufferMB = Math.round((adapter.limits?.maxBufferSize || 0) / (1024 * 1024));
    const infoDesc = adapter.info?.description || adapter.info?.architecture || adapter.info?.vendor || 'WebGPU GPU';
    this.adapterInfo = infoDesc;

    let refChw = refInput1x;
    let refMax = wasmRefMaxConf;
    if (!refChw) {
      report(18, msg('calibPrepRef', 'Подготовка эталонного кадра для проверки паритета...'));
      try {
        refChw = await loadReferenceChw(sampleUrl, 0.42, 640);
      } catch {
        refChw = new Float32Array(3 * 640 * 640);
      }
    }
    checkAbort();

    if (refMax === null && refChw) {
      report(26, msg('calibMeasureWasm', 'Замер эталона WASM для сверки GPU...'));
      let wasmSess = null;
      let wt = null;
      let wout = null;
      try {
        if (window.ort?.env?.wasm) {
          window.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
          window.ort.env.wasm.numThreads = 1;
          window.ort.env.wasm.simd = true;
        }
        wasmSess = await window.ort.InferenceSession.create(this._getModelInput(), { executionProviders: ['wasm'] });
        wt = new window.ort.Tensor('float32', refChw, [1, 3, 640, 640]);
        const wr = await wasmSess.run({ [wasmSess.inputNames[0]]: wt });
        wout = wr[wasmSess.outputNames[0]];
        const wd = wout.data;
        const [, , rn] = wout.dims;
        let mx = 0;
        for (let i = 0; i < rn; i++) {
          const v = wd[4 * rn + i];
          if (v > mx) mx = v;
        }
        refMax = mx;
      } catch {
        refMax = null;
      } finally {
        wt?.dispose?.();
        wout?.dispose?.();
        await wasmSess?.release?.().catch(() => {});
      }
    }
    checkAbort();

    const candidateConfigs = [
      { preferredLayout: 'NCHW', optLevel: 'all', label: 'NCHW / opt=all' },
      { preferredLayout: 'NCHW', optLevel: 'basic', label: 'NCHW / opt=basic' },
      { preferredLayout: null, optLevel: 'basic', label: 'auto / opt=basic' },
      { preferredLayout: null, optLevel: 'all', label: 'auto / opt=all' }
    ];

    let winningCfg = null;
    let msBatch2 = Infinity;
    let lastFailReason = 'Неизвестная ошибка WebGPU';
    let winningParityMax = 0;

    for (let idx = 0; idx < candidateConfigs.length; idx++) {
      checkAbort();
      const cfg = candidateConfigs[idx];
      const pct = 35 + idx * 10;
      report(pct, msg('calibTestingCfg', `Проверка ${infoDesc} (${cfg.label}, batch=2)...`, { info: infoDesc, label: cfg.label }));

      try {
        await this.createSession({ optLevel: cfg.optLevel, preferredLayout: cfg.preferredLayout });
        const res2 = await this._runAndCheckBatch(2, refChw, refMax);
        if (res2.parity.ok) {
          winningCfg = cfg;
          msBatch2 = res2.elapsed;
          winningParityMax = res2.parity.maxConfs[0] || 0;
          break;
        } else {
          lastFailReason = `${cfg.label}: ${res2.parity.reason}`;
          console.warn(`[Accel Calibration] Отклонён ${cfg.label}:`, res2.parity.reason);
        }
      } catch (err) {
        lastFailReason = `${cfg.label}: ${err.message || err}`;
        console.warn(`[Accel Calibration] Сбой ${cfg.label}:`, err);
      }
    }
    checkAbort();

    if (!winningCfg) {
      this.isReady = false;
      const profile = {
        backend: 'wasm',
        batchSize: 1,
        adapterInfo: infoDesc,
        reason: `WebGPU не прошёл проверку паритета: ${lastFailReason}`,
        wasmRefMaxConf: refMax !== null ? +refMax.toFixed(4) : null,
        calibratedAt: Date.now()
      };
      WebGPUExecutor.saveProfile(profile);
      report(100, msg('calibFallbackWasm', 'WebGPU отклонён (ошибка паритета) -> активен WASM-пул'));
      return profile;
    }

    let chosenBatch = 2;
    let msBatch4 = null;

    if (maxBufferMB === 0 || maxBufferMB >= 128) {
      report(82, msg('calibTestingBatch4', `${winningCfg.label} batch=2 ок (${Math.round(msBatch2)} мс). Тест batch=4...`, { label: winningCfg.label, ms: Math.round(msBatch2) }));
      try {
        const res4 = await this._runAndCheckBatch(4, refChw, refMax);
        if (res4.parity.ok && res4.elapsed / 4 <= (msBatch2 / 2) * 1.15) {
          msBatch4 = res4.elapsed;
          chosenBatch = 4;
          winningParityMax = res4.parity.maxConfs[0] || winningParityMax;
        } else if (!res4.parity.ok) {
          console.warn('[Accel Calibration] batch=4 не прошёл паритет, откат на batch=2:', res4.parity.reason);
          await this.createSession({ optLevel: winningCfg.optLevel, preferredLayout: winningCfg.preferredLayout });
        }
      } catch (err) {
        console.warn('WebGPU batch=4 крашнулся, откат на batch=2:', err);
        report(88, msg('calibRollbackBatch2', 'batch=4 не поместился в память GPU, откат на batch=2...'));
        try {
          await this.createSession({ optLevel: winningCfg.optLevel, preferredLayout: winningCfg.preferredLayout });
          const retest = await this._runAndCheckBatch(2, refChw, refMax);
          if (!retest.parity.ok) throw new Error(retest.parity.reason);
          chosenBatch = 2;
        } catch (recreateErr) {
          console.warn('Не удалось восстановить WebGPU после сбоя batch=4, откат на WASM:', recreateErr);
          this.isReady = false;
          const profile = {
            backend: 'wasm',
            batchSize: 1,
            reason: 'Потеря GPUDevice после batch=4',
            calibratedAt: Date.now()
          };
          WebGPUExecutor.saveProfile(profile);
          return profile;
        }
      }
    }
    checkAbort();

    this.batchSize = chosenBatch;
    this.optLevel = winningCfg.optLevel;
    this.preferredLayout = winningCfg.preferredLayout;
    this.isReady = true;

    const profile = {
      backend: 'webgpu',
      batchSize: chosenBatch,
      optLevel: winningCfg.optLevel,
      preferredLayout: winningCfg.preferredLayout,
      adapterInfo: infoDesc,
      msBatch2: Math.round(msBatch2),
      msBatch4: msBatch4 !== null ? Math.round(msBatch4) : null,
      parityMaxConf: +winningParityMax.toFixed(4),
      wasmRefMaxConf: refMax !== null ? +refMax.toFixed(4) : null,
      calibratedAt: Date.now()
    };
    WebGPUExecutor.saveProfile(profile);
    report(100, msg('calibDoneGpu', `Готово: WebGPU (${winningCfg.label}, batch=${chosenBatch})`, { label: winningCfg.label, batch: chosenBatch }));
    return profile;
  }

  async initFromProfile(profile) {
    if (!profile || profile.backend !== 'webgpu' || !navigator.gpu) {
      this.isReady = false;
      return false;
    }
    try {
      this.batchSize = profile.batchSize || 2;
      this.optLevel = profile.optLevel || 'basic';
      this.preferredLayout = profile.preferredLayout !== undefined ? profile.preferredLayout : 'NCHW';
      this.adapterInfo = profile.adapterInfo || 'WebGPU';
      await this.createSession({ optLevel: this.optLevel, preferredLayout: this.preferredLayout });
      this.isReady = true;
      return true;
    } catch (err) {
      console.warn('Ошибка восстановления WebGPU-сессии из профиля:', err);
      this.isReady = false;
      return false;
    }
  }

  async runBatchedSweeps(baseRgba, tasks, onBatchDone, { onBatchProgress, signal } = {}) {
    if (!this.isReady || !this.session) {
      throw new Error('WebGPU сессия не готова');
    }

    const allBoxes = [];
    let maxRawConf = 0;
    const B = this.batchSize;
    const totalBatches = Math.ceil(tasks.length / B);
    let batchMsSum = 0;
    let doneSlices = 0;

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      if (signal && signal.aborted) {
        const err = new Error('GPU-обработка отменена пользователем');
        err.name = 'AbortError';
        throw err;
      }

      const offset = batchIdx * B;
      const chunk = tasks.slice(offset, offset + B);
      const curBatch = chunk.length;
      const dstSize = chunk[0].dstSize || 640;
      const area = dstSize * dstSize;
      const inv255 = 1.0 / 255.0;

      if (onBatchProgress) {
        const avgBatchMs = batchIdx > 0 ? batchMsSum / batchIdx : null;
        const etaSec = avgBatchMs !== null ? ((totalBatches - batchIdx) * avgBatchMs) / 1000 : null;
        onBatchProgress({
          phase: 'running',
          batchIdx: batchIdx + 1,
          totalBatches,
          doneSlices,
          totalSlices: tasks.length,
          batchMs: batchIdx > 0 ? Math.round(avgBatchMs) : null,
          etaSec
        });
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      }

      const tPrep0 = performance.now();
      const floatArr = new Float32Array(curBatch * 3 * area);
      const src = baseRgba;

      for (let b = 0; b < curBatch; b++) {
        const k = chunk[b].k;
        const baseOut = b * 3 * area;
        for (let p = 0; p < area; p++) {
          const p4 = p * 4;
          const r = src[p4];
          const g = src[p4 + 1];
          const bl = src[p4 + 2];
          const mean = (r + g + bl) / 3.0;

          const satR = Math.min(255, Math.max(0, mean + k * (r - mean)));
          const satG = Math.min(255, Math.max(0, mean + k * (g - mean)));
          const satB = Math.min(255, Math.max(0, mean + k * (bl - mean)));

          floatArr[baseOut + p] = satR * inv255;
          floatArr[baseOut + area + p] = satG * inv255;
          floatArr[baseOut + area * 2 + p] = satB * inv255;
        }
      }
      const prepTotalMs = performance.now() - tPrep0;

      const tInfer0 = performance.now();
      const tensor = new window.ort.Tensor('float32', floatArr, [curBatch, 3, dstSize, dstSize]);
      let outTensor = null;
      let data = null;
      let dims = null;

      try {
        const feeds = { [this.session.inputNames[0]]: tensor };
        const results = await this.session.run(feeds);
        outTensor = results[this.session.outputNames[0]];
        const raw = typeof outTensor.getData === 'function'
          ? await outTensor.getData()
          : outTensor.data;
        data = new Float32Array(raw);
        dims = [...outTensor.dims];
      } finally {
        tensor.dispose?.();
        outTensor?.dispose?.();
      }
      const inferTotalMs = performance.now() - tInfer0;
      const batchWallMs = prepTotalMs + inferTotalMs;
      batchMsSum += batchWallMs;

      const [, channels, numBoxes] = dims;
      const perSlicePrep = Math.round(prepTotalMs / curBatch);
      const perSliceInfer = Math.round(inferTotalMs / curBatch);
      const perSliceTotal = Math.round(batchWallMs / curBatch);

      for (let b = 0; b < curBatch; b++) {
        const task = chunk[b];
        const { sweepIndex, k, meta, confThreshold = 0.20, nmsIouThreshold = 0.45 } = task;
        const batchStride = b * channels * numBoxes;
        const rawBoxes = [];

        for (let i = 0; i < numBoxes; i++) {
          const conf = data[batchStride + 4 * numBoxes + i];
          if (conf > maxRawConf) maxRawConf = conf;
          if (conf >= confThreshold) {
            const cx = data[batchStride + 0 * numBoxes + i];
            const cy = data[batchStride + 1 * numBoxes + i];
            const bw = data[batchStride + 2 * numBoxes + i];
            const bh = data[batchStride + 3 * numBoxes + i];
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

        const finalBoxes = applyNMS(rawBoxes, nmsIouThreshold);
        finalBoxes.forEach(bx => allBoxes.push(bx));
        doneSlices++;

        if (onBatchDone) {
          onBatchDone({
            workerId: `GPU-B${curBatch}`,
            sweepIndex,
            k,
            prepMs: perSlicePrep,
            inferMs: perSliceInfer,
            totalMs: perSliceTotal,
            boxes: finalBoxes
          });
        }
      }

      if (onBatchProgress) {
        const avgBatchMs = batchMsSum / (batchIdx + 1);
        const remBatches = totalBatches - (batchIdx + 1);
        onBatchProgress({
          phase: 'batch_done',
          batchIdx: batchIdx + 1,
          totalBatches,
          doneSlices,
          totalSlices: tasks.length,
          batchMs: Math.round(batchWallMs),
          etaSec: (remBatches * avgBatchMs) / 1000
        });
      }
    }

    return { allBoxes, maxRawConf };
  }
}
