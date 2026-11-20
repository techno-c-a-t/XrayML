/**
 * debug/debug.js
 * Параллельный инференс 30 спектральных срезов на пуле Web Workers.
 * 
 * Архитектура:
 * 1. Пул задач (Queue): как только воркер ядра освобождается, ему выдается следующий срез.
 * 2. Десатурация, нормализация и ONNX инференс перенесены ВНУТРЬ воркеров,
 *    что разгружает главный поток и устраняет задержку старта (было 5-7с, стало <50мс).
 * 3. Количество воркеров динамически: cores - 2 (если ядер > 4) или cores - 1 (если <= 4).
 * 4. Управление отображением: С детекцией / Нормализованный / Исходный скан.
 */

import { XrayNormalizer } from './debug-normalizer.js?v=13';
import { YoloDetector } from '../yolo-detector.js?v=8';
import { WebGPUExecutor, generateKSweepGrid, getOptimalWasmWorkerCount, loadReferenceChw } from './accel-engine.js?v=2';

const SAMPLES = [
  { id: 'image2', name: 'Снимок 2 (Оружие)', path: '../samples/image2.jpg' },
  { id: 'image9', name: 'Снимок 9 (Оружие)', path: '../samples/image9.png' },
  { id: 'image10', name: 'Снимок 10 (Оружие)', path: '../samples/image10.png' },
  { id: 'image1', name: 'Снимок 1', path: '../samples/image1.jpg' },
  { id: 'image3', name: 'Снимок 3', path: '../samples/image3.png' }
];

// Динамический расчет числа параллельных воркеров (с лимитом на мобильных big.LITTLE)
const HARDWARE_CORES = navigator.hardwareConcurrency || 4;
const WORKER_COUNT = getOptimalWasmWorkerCount();
const DYNAMIC_MODEL_PATH = '../models/best_dynamic.onnx';

const state = {
  normalizer: new XrayNormalizer(),
  detector: new YoloDetector({ modelPath: DYNAMIC_MODEL_PATH, confThreshold: 0.20 }),
  pool: null,
  gpuExecutor: null,
  calibAbortController: null,
  scanAbortController: null,
  samples: [...SAMPLES],
  currentImage: null,
  currentImageId: null,
  activeView: 'detected',
  boxes: [],
  hardwareCores: HARDWARE_CORES,
  workerCount: WORKER_COUNT,
  isScanning: false,
  lastTraceData: null,
  chartPoints: [],
  // Настройки Extended Mode
  extPreset: 'deep',
  extConf: 0.20,
  extSteps: 30,
  extMinHits: 2,
  extIou: 0.45,
  // Настройки Smart / Grid сетки
  gridMargin: 0.10,
  gridStep: 0.05,
  // Настройки Single Mode
  singleConf: 0.35,
  // Научные гиперпараметры (Research Lab)
  imageSmoothingQuality: 'high',
  nmsIouThreshold: 0.45,
  smartMaxStage1: 10,
  smartWhisperConf: 0.00,
  gpuFramesPerCore: 2
};
window.state = state;

const els = {
  hardwareStatus: document.getElementById('hardwareStatus'),
  statusDot: document.getElementById('statusDot'),
  themeBtn: document.getElementById('themeBtn'),
  themeIcon: document.getElementById('themeIcon'),
  samplesCarousel: document.getElementById('samplesCarousel'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  resolutionWarning: document.getElementById('resolutionWarning'),
  scanModeSelect: document.getElementById('scanModeSelect'),
  optExtendedMode: document.getElementById('optExtendedMode'),
  btnRunScan: document.getElementById('btnRunScan'),
  btnCopyTrace: document.getElementById('btnCopyTrace'),
  // Acceleration & Calibration UI
  accelProfileVal: document.getElementById('accelProfileVal'),
  btnRunCalibration: document.getElementById('btnRunCalibration'),
  btnResetCalib: document.getElementById('btnResetCalib'),
  gridMarginRange: document.getElementById('gridMarginRange'),
  gridMarginVal: document.getElementById('gridMarginVal'),
  gridStepRange: document.getElementById('gridStepRange'),
  gridStepVal: document.getElementById('gridStepVal'),
  calibModal: document.getElementById('calibModal'),
  calibModalSub: document.getElementById('calibModalSub'),
  calibProgressFill: document.getElementById('calibProgressFill'),
  btnCancelCalib: document.getElementById('btnCancelCalib'),
  // GPU working overlay dialog
  gpuWorkModal: document.getElementById('gpuWorkModal'),
  gpuWorkSub: document.getElementById('gpuWorkSub'),
  gpuWorkEta: document.getElementById('gpuWorkEta'),
  gpuWorkProgressFill: document.getElementById('gpuWorkProgressFill'),
  btnCancelGpuWork: document.getElementById('btnCancelGpuWork'),
  // Live status banner
  inferStatusBanner: document.getElementById('inferStatusBanner'),
  bannerSpinner: document.getElementById('bannerSpinner'),
  bannerTitle: document.getElementById('bannerTitle'),
  bannerSub: document.getElementById('bannerSub'),
  bannerMetric: document.getElementById('bannerMetric'),
  // Progress
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  // Live Chart & Stats
  liveChartCanvas: document.getElementById('liveChartCanvas'),
  liveCurrentMs: document.getElementById('liveCurrentMs'),
  liveMinMs: document.getElementById('liveMinMs'),
  liveMaxMs: document.getElementById('liveMaxMs'),
  liveAvgMs: document.getElementById('liveAvgMs'),
  // Cores grid
  coresGrid: document.getElementById('coresGrid'),
  coresModeBadge: document.getElementById('coresModeBadge'),
  activeThreadsBadge: document.getElementById('activeThreadsBadge'),
  poolDescText: document.getElementById('poolDescText'),
  // Canvas viewport & tabs
  displayCanvas: document.getElementById('displayCanvas'),
  normalizedCanvas: document.getElementById('normalizedCanvas'),
  originalCanvas: document.getElementById('originalCanvas'),
  detectStatusPill: document.getElementById('detectStatusPill'),
  detectStatusText: document.getElementById('detectStatusText'),
  tabDetected: document.getElementById('tabDetected'),
  tabNormalized: document.getElementById('tabNormalized'),
  tabOriginal: document.getElementById('tabOriginal'),
  // Settings & Presets
  extendedDrawer: document.getElementById('extendedDrawer'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  extPresetSelect: document.getElementById('extPresetSelect'),
  extConfRange: document.getElementById('extConfRange'),
  extConfVal: document.getElementById('extConfVal'),
  extStepRange: document.getElementById('extStepRange'),
  extStepVal: document.getElementById('extStepVal'),
  extIouRange: document.getElementById('extIouRange'),
  extIouVal: document.getElementById('extIouVal'),
  extMinHitsRange: document.getElementById('extMinHitsRange'),
  extMinHitsVal: document.getElementById('extMinHitsVal'),
  // Single mode settings
  confRange: document.getElementById('confRange'),
  confVal: document.getElementById('confVal'),
  satRange: document.getElementById('satRange'),
  satVal: document.getElementById('satVal'),
  whiteRange: document.getElementById('whiteRange'),
  whiteVal: document.getElementById('whiteVal'),
  normalizeToggle: document.getElementById('normalizeToggle'),
  // Research Lab hyperparameters
  smoothingSelect: document.getElementById('smoothingSelect'),
  nmsIouRange: document.getElementById('nmsIouRange'),
  nmsIouVal: document.getElementById('nmsIouVal'),
  smartStage1Range: document.getElementById('smartStage1Range'),
  smartStage1Val: document.getElementById('smartStage1Val'),
  smartWhisperRange: document.getElementById('smartWhisperRange'),
  smartWhisperVal: document.getElementById('smartWhisperVal'),
  distThreshRange: document.getElementById('distThreshRange'),
  distThreshVal: document.getElementById('distThreshVal'),
  gpuFramesPerCoreRange: document.getElementById('gpuFramesPerCoreRange'),
  gpuFramesPerCoreVal: document.getElementById('gpuFramesPerCoreVal'),
  // Breakdown
  dbgTotalTime: document.getElementById('dbgTotalTime'),
  timelineBar: document.getElementById('timelineBar'),
  breakdownTbody: document.getElementById('breakdownTbody'),
  sweepsTbody: document.getElementById('sweepsTbody'),
  sweepsTitle: document.getElementById('sweepsTitle'),
  sweepsSubtitle: document.getElementById('sweepsSubtitle')
};

// -----------------------------------------------------------------------------
// Пул параллельных Web Workers с очередью задач
// -----------------------------------------------------------------------------
class ParallelWorkerPool {
  constructor(size, modelPath) {
    this.size = size;
    this.modelPath = modelPath;
    this.workers = [];
    this.idleWorkers = [];
  }

  async init(onProgress) {
    let readyCount = 0;

    const spawnOne = (i) => new Promise((resolve, reject) => {
      const w = new Worker('./debug-worker.js?v=14');
      w.workerId = i;

      const onInitMsg = (evt) => {
        const { type, workerId, error } = evt.data;
        if (type === 'ready') {
          w.removeEventListener('message', onInitMsg);
          readyCount++;
          if (onProgress) onProgress(readyCount, this.size);
          this.workers.push(w);
          this.idleWorkers.push(w);
          resolve(w);
        } else if (type === 'error') {
          w.removeEventListener('message', onInitMsg);
          w.terminate();
          reject(new Error(`Воркер #${workerId} ошибка: ${error}`));
        }
      };

      w.addEventListener('message', onInitMsg);
      w.onerror = (err) => {
        w.terminate();
        reject(new Error(`Сбой скрипта воркера #${i}: ${err.message}`));
      };

      w.postMessage({ type: 'init', payload: { workerId: i, modelPath: this.modelPath } });
    });

    // Прогреваем кэш CDN/модели первым воркером, затем поднимаем остальных параллельно
    if (this.size > 0) {
      await spawnOne(0);
    }
    if (this.size > 1) {
      const rest = [];
      for (let i = 1; i < this.size; i++) {
        rest.push(spawnOne(i));
      }
      const settled = await Promise.allSettled(rest);
      const failures = settled.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`[ParallelWorkerPool] Не удалось запустить ${failures.length} воркеров:`, failures.map(f => f.reason?.message));
      }
    }
    if (this.workers.length === 0) {
      throw new Error('Ни один WASM-воркер не инициализировался');
    }
  }

  async setBaseImage(baseRgba) {
    const promises = this.workers.map(w => {
      return new Promise(resolve => {
        const handler = (evt) => {
          if (evt.data && evt.data.type === 'base_set') {
            w.removeEventListener('message', handler);
            resolve();
          }
        };
        w.addEventListener('message', handler);
        w.postMessage({ type: 'set_base', payload: { baseRgba: new Uint8ClampedArray(baseRgba) } });
      });
    });
    await Promise.all(promises);
  }

  async runParallelSweeps(tasks, onSweepBusy, onSweepDone) {
    return new Promise((resolve) => {
      const totalSweeps = tasks.length;
      let completedCount = 0;
      const allBoxes = [];
      const queue = [...tasks];

      const dispatchNext = () => {
        if (completedCount === totalSweeps) {
          resolve(allBoxes);
          return;
        }

        while (this.idleWorkers.length > 0 && queue.length > 0) {
          const worker = this.idleWorkers.pop();
          const task = queue.shift();

          const onMessage = (evt) => {
            const data = evt.data;
            if (data.type === 'busy') {
              if (onSweepBusy) onSweepBusy(data.workerId, data.sweepIndex, data.k);
            } else if (data.type === 'sweep_done') {
              if (onSweepDone) onSweepDone(data.workerId, data.sweepIndex, data.k, data.prepMs, data.inferMs, data.totalMs, data.boxes, data.maxRawConf || 0);
              data.boxes.forEach(b => allBoxes.push(b));
            } else if (data.type === 'idle') {
              worker.removeEventListener('message', onMessage);
              this.idleWorkers.push(worker);
              completedCount++;
              dispatchNext();
            } else if (data.type === 'sweep_error') {
              console.error(`Ошибка среза #${data.sweepIndex} на воркере #${data.workerId}:`, data.error);
              worker.removeEventListener('message', onMessage);
              this.idleWorkers.push(worker);
              completedCount++;
              dispatchNext();
            }
          };

          worker.addEventListener('message', onMessage);
          worker.postMessage({ type: 'run_sweep', payload: task });
        }
      };

      dispatchNext();
    });
  }

  async runSingleSweep(task) {
    while (this.idleWorkers.length === 0) {
      await new Promise(r => setTimeout(r, 50));
    }
    const worker = this.idleWorkers.pop();

    return new Promise((resolve, reject) => {
      let resultBoxes = [];
      let totalMs = 0;

      const onMessage = (evt) => {
        const data = evt.data;
        if (data.type === 'sweep_done') {
          resultBoxes = data.boxes;
          totalMs = data.totalMs || data.inferMs;
        } else if (data.type === 'idle') {
          worker.removeEventListener('message', onMessage);
          this.idleWorkers.push(worker);
          resolve({ boxes: resultBoxes, inferMs: totalMs });
        } else if (data.type === 'sweep_error') {
          worker.removeEventListener('message', onMessage);
          this.idleWorkers.push(worker);
          reject(new Error(data.error));
        }
      };

      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'run_sweep', payload: task });
    });
  }
}

// -----------------------------------------------------------------------------
// Инициализация сетки ядер (big.LITTLE Monitor)
// -----------------------------------------------------------------------------
function setupCoresGrid() {
  els.coresGrid.innerHTML = '';
  const totalCores = state.hardwareCores;
  const workers = state.workerCount;

  for (let i = 0; i < totalCores; i++) {
    const meter = document.createElement('div');
    meter.className = 'core-meter';
    meter.id = `coreMeter-${i}`;

    let roleName = '';
    let isWorker = false;

    if (i < workers) {
      isWorker = true;
      roleName = `Воркер #${i}`;
    } else if (i === workers) {
      roleName = 'UI / Event Loop';
      meter.classList.add('is-reserved');
    } else if (i === workers + 1) {
      roleName = 'OS Резерв';
      meter.classList.add('is-reserved');
    } else {
      roleName = 'Система';
      meter.classList.add('is-reserved');
    }

    meter.innerHTML = `
      <div class="core-meter-header">
        <span class="core-name">Ядро #${i}</span>
        <span class="core-badge">${roleName}</span>
      </div>
      <div class="core-bar-track">
        <div class="core-bar-fill" id="coreBar-${i}" style="width: ${isWorker ? '0%' : '12%'}"></div>
      </div>
      <div class="core-status-text" id="coreStatus-${i}">${isWorker ? 'Свободно (готов)' : 'Фоновый поток'}</div>
    `;

    els.coresGrid.appendChild(meter);
  }

  els.coresModeBadge.textContent = `${workers} CPU воркеров · порог GPU > ${workers * 2} кадров`;
  els.activeThreadsBadge.textContent = `${workers} воркеров (из ${totalCores} ядер)`;
  els.poolDescText.textContent = `При ≤ ${workers * 2} кадрах (≤ 2 на ядро) расчёт идёт на ${workers} CPU-воркерах (WASM SIMD). При > ${workers * 2} кадрах — маршрутизация на WebGPU (если калибровка прошла проверку паритета). Оставшееся ядро зарезервировано под UI.`;
}

function setCoreBusy(workerId, sweepIndex, k) {
  const meter = document.getElementById(`coreMeter-${workerId}`);
  const bar = document.getElementById(`coreBar-${workerId}`);
  const status = document.getElementById(`coreStatus-${workerId}`);

  if (meter && bar && status) {
    meter.classList.add('is-busy');
    bar.style.width = '100%';
    bar.style.background = '#00ADB5';
    status.textContent = `Срез #${sweepIndex + 1} (k=${k.toFixed(2)})`;
  }
}

function setCoreIdle(workerId, totalMs) {
  const meter = document.getElementById(`coreMeter-${workerId}`);
  const bar = document.getElementById(`coreBar-${workerId}`);
  const status = document.getElementById(`coreStatus-${workerId}`);

  if (meter && bar && status) {
    meter.classList.remove('is-busy');
    bar.style.width = '0%';
    status.textContent = `Свободно · ${totalMs} ms`;
  }
}

// -----------------------------------------------------------------------------
// Осциллограф (Canvas Chart)
// -----------------------------------------------------------------------------
function drawLiveChart() {
  const canvas = els.liveChartCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 800;
  const h = 160;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Сетка
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let y = 30; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Порог 1000 мс
  const warnY = 20;
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, warnY);
  ctx.lineTo(w, warnY);
  ctx.stroke();
  ctx.setLineDash([]);

  const points = state.chartPoints;
  if (points.length < 1) {
    ctx.restore();
    return;
  }

  const maxVal = Math.max(600, ...points.map(p => p.totalMs * 1.25));
  const stepX = w / Math.max(10, points.length);

  // Линия инференса ONNX (голубой)
  ctx.beginPath();
  ctx.strokeStyle = '#00ADB5';
  ctx.lineWidth = 2.5;
  points.forEach((p, idx) => {
    const x = idx * stepX + 10;
    const y = h - (p.inferMs / maxVal) * (h - 35) - 10;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Линия десатурации + тензора (зеленый)
  ctx.beginPath();
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = 1.5;
  points.forEach((p, idx) => {
    const x = idx * stepX + 10;
    const y = h - (p.prepMs / maxVal) * (h - 35) - 10;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Точки на линии
  points.forEach((p, idx) => {
    const x = idx * stepX + 10;
    const y = h - (p.inferMs / maxVal) * (h - 35) - 10;
    ctx.fillStyle = '#00ADB5';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function updateChartStats() {
  const points = state.chartPoints;
  if (points.length === 0) return;

  const times = points.map(p => p.totalMs);
  const cur = times[times.length - 1];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;

  els.liveCurrentMs.textContent = `${cur.toFixed(0)} ms`;
  els.liveMinMs.textContent = `${min.toFixed(0)} ms`;
  els.liveMaxMs.textContent = `${max.toFixed(0)} ms`;
  els.liveAvgMs.textContent = `${avg.toFixed(0)} ms`;
}

// -----------------------------------------------------------------------------
// Карусель, загрузка кастомных файлов и проверка странных разрешений
// -----------------------------------------------------------------------------
function checkResolutionWarning(w, h) {
  if (!els.resolutionWarning) return;
  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const aspect = minDim > 0 ? maxDim / minDim : 1;
  const warnings = [];

  if (minDim < 250) {
    warnings.push(`очень низкое разрешение (${w}×${h} px) — возможна нехватка деталей`);
  }
  if (maxDim > 3000) {
    warnings.push(`сверхвысокое разрешение (${w}×${h} px) — при сжатии в 640×640 мелкие объекты могут потеряться`);
  }
  if (aspect > 3.0) {
    warnings.push(`нестандартное соотношение сторон (${aspect.toFixed(1)}:1) — большая доля серого паддинга`);
  }

  if (warnings.length > 0) {
    els.resolutionWarning.textContent = `⚠ Нестандартный снимок: ${warnings.join('; ')}.`;
    els.resolutionWarning.classList.remove('is-hidden');
  } else {
    els.resolutionWarning.textContent = '';
    els.resolutionWarning.classList.add('is-hidden');
  }
}

function prepareLetterboxRgba(sourceCanvas, dstSize = 640) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const scale = Math.min(dstSize / w, dstSize / h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  const padX = (dstSize - newW) / 2;
  const padY = (dstSize - newH) / 2;
  const meta = { srcW: w, srcH: h, scale, padX, padY };

  const sweepCanvas = document.createElement('canvas');
  sweepCanvas.width = dstSize;
  sweepCanvas.height = dstSize;
  const sweepCtx = sweepCanvas.getContext('2d', { willReadFrequently: true });
  sweepCtx.imageSmoothingEnabled = true;
  sweepCtx.imageSmoothingQuality = state.imageSmoothingQuality || 'high';
  sweepCtx.fillStyle = '#727272';
  sweepCtx.fillRect(0, 0, dstSize, dstSize);
  sweepCtx.drawImage(sourceCanvas, 0, 0, w, h, padX, padY, newW, newH);

  return {
    rgba: sweepCtx.getImageData(0, 0, dstSize, dstSize).data,
    meta
  };
}

function deleteCustomSample(id) {
  const target = state.samples.find(s => s.id === id);
  if (target && target.isObjectUrl) {
    URL.revokeObjectURL(target.path);
  }
  state.samples = state.samples.filter(s => s.id !== id);
  buildCarousel();
  if (state.currentImageId === id && state.samples.length > 0) {
    loadSample(state.samples[0]);
  }
}

function handleCustomFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    if (els.resolutionWarning) {
      els.resolutionWarning.textContent = '⚠ Поддерживаются только изображения (PNG, JPG, WebP, BMP и др.).';
      els.resolutionWarning.classList.remove('is-hidden');
    }
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  const customSample = {
    id: `custom_${Date.now()}`,
    name: file.name,
    path: objectUrl,
    isCustom: true,
    isObjectUrl: true
  };
  state.samples.unshift(customSample);
  buildCarousel();
  loadSample(customSample);
}

function buildCarousel() {
  els.samplesCarousel.innerHTML = '';
  state.samples.forEach((sample, idx) => {
    const btn = document.createElement('div');
    btn.className = `sample-thumb ${sample.id === state.currentImageId ? 'is-active' : ''}`;
    btn.dataset.id = sample.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', sample.name);

    const imgEl = document.createElement('img');
    imgEl.src = sample.path;
    imgEl.alt = sample.name;
    btn.appendChild(imgEl);

    const tag = document.createElement('span');
    tag.className = 'sample-tag';
    tag.textContent = sample.isCustom ? 'USR' : `#${idx + 1}`;
    btn.appendChild(tag);

    if (sample.isCustom) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sample-btn-delete';
      delBtn.title = 'Удалить загруженный снимок';
      delBtn.setAttribute('aria-label', `Удалить ${sample.name}`);
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.isScanning) deleteCustomSample(sample.id);
      });
      btn.appendChild(delBtn);
    }

    const activate = () => {
      if (state.isScanning) return;
      document.querySelectorAll('.sample-thumb').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      loadSample(sample);
    };
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    els.samplesCarousel.appendChild(btn);
  });
}

async function loadSample(sample) {
  state.currentImageId = sample.id;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = sample.path;
  await img.decode();
  state.currentImage = img;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  checkResolutionWarning(w, h);

  // 1. Исходный холст (неизменный чистый оригинал)
  els.originalCanvas.width = w;
  els.originalCanvas.height = h;
  const origCtx = els.originalCanvas.getContext('2d', { willReadFrequently: true });
  origCtx.drawImage(img, 0, 0);

  // 2. Нормализованный холст (физическая нормализация полярности и белого)
  els.normalizedCanvas.width = w;
  els.normalizedCanvas.height = h;
  const normCtx = els.normalizedCanvas.getContext('2d', { willReadFrequently: true });
  normCtx.drawImage(img, 0, 0);
  const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
  state.polarityInfo = basePrep.polarity;

  const polText = state.polarityInfo.isInverted
    ? `Негатив (инвертирован, М1:${state.polarityInfo.isNegMethod1 ? '+' : '-'}, М2:${state.polarityInfo.isNegMethod2 ? '+' : '-'})`
    : `Позитив (прямой, М1:${state.polarityInfo.isNegMethod1 ? '+' : '-'}, М2:${state.polarityInfo.isNegMethod2 ? '+' : '-'})`;

  els.bannerTitle.textContent = `Снимок загружен: ${sample.name}`;
  els.bannerSub.textContent = `Разрешение: ${w} × ${h} px · Полярность: ${polText} · Готов к параллельному анализу`;
  els.bannerMetric.textContent = 'Готов';

  state.boxes = [];
  state.lastTraceData = null;
  updateDetectPill();
  renderDisplay();
}

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

function fuseMultiSpectralBoxes(boxes, iouThreshold = 0.45, minDetections = 2, totalSweeps = 30) {
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

    // Отсекаем шум, если объект подтвердился менее чем на minDetections срезах
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
      totalSweeps: totalSweeps,
      label: 'Gun'
    });
  }

  fusedBoxes.sort((a, b) => b.conf - a.conf);
  return fusedBoxes;
}

function setScanControlsDisabled(disabled) {
  if (els.btnRunScan) els.btnRunScan.disabled = disabled;
  if (els.scanModeSelect) els.scanModeSelect.disabled = disabled;
}

// -----------------------------------------------------------------------------
// ПАРАЛЛЕЛЬНЫЙ ПРОФИЛИРОВАННЫЙ АНАЛИЗ (EXTENDED MODE)
// -----------------------------------------------------------------------------
async function runParallelScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  state.scanAbortController = new AbortController();

  const img = state.currentImage;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const shouldNormalize = !els.normalizeToggle || els.normalizeToggle.checked;

  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = `EXTENDED АНАЛИЗ (${state.extSteps} СПЕКТРОВ)...`;
  els.bannerSub.textContent = `Подготовка срезов (порог GPU > ${state.workerCount * 2} кадров)...`;
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';
  els.progressLabel.textContent = 'Инициализация срезов...';

  state.chartPoints = [];
  drawLiveChart();

  const trace = {
    mode: 'extended',
    backendLabel: '',
    routingReason: '',
    startedAt: new Date().toISOString(),
    image: { width: w, height: h, id: state.currentImageId },
    hardware: {
      cores: state.hardwareCores,
      workers: state.workerCount,
      gpuReady: !!(state.gpuExecutor && state.gpuExecutor.isReady),
      gpuBatch: state.gpuExecutor?.batchSize || 1,
      crossOriginIsolated: window.crossOriginIsolated
    },
    timings: {
      basePrepMs: 0,
      letterboxScaleMs: 0,
      syncBaseMs: 0,
      parallelWallMs: 0,
      wbfMs: 0,
      finalRenderMs: 0,
      totalWallMs: 0
    },
    sweeps: []
  };

  const tStartWall = performance.now();

  try {
    // 1. Базовая физическая нормализация кадра из оригинального холста
    const t0 = performance.now();
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    if (shouldNormalize) {
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
      trace.polarity = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }
    trace.timings.basePrepMs = Math.round(performance.now() - t0);

    // 2. Масштабирование до 640x640 для спектрального анализа (Letterbox с high smoothing)
    const t1 = performance.now();
    const dstSize = 640;
    const { rgba: baseSweepRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );
    trace.timings.letterboxScaleMs = Math.round(performance.now() - t1);

    // 3. Формирование пула задач
    const numSteps = state.extSteps;
    const stepSize = numSteps > 1 ? 0.95 / (numSteps - 1) : 0;
    const tasks = [];
    for (let i = 0; i < numSteps; i++) {
      const k = parseFloat((i * stepSize).toFixed(3));
      tasks.push({ sweepIndex: i, k, meta, dstSize, confThreshold: state.extConf, nmsIouThreshold: state.nmsIouThreshold });
    }

    // 4. Запуск через единый роутер (GPU при > 2*workers кадров, иначе CPU WASM-пул)
    const tParallelStart = performance.now();
    let completedCount = 0;

    const routerRes = await executeSweepsWithRouter(
      baseSweepRgba,
      tasks,
      (workerId, sweepIndex, k) => {
        setCoreBusy(workerId, sweepIndex, k);
      },
      (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes) => {
        completedCount++;
        if (typeof workerId === 'number') setCoreIdle(workerId, totalMs);

        trace.sweeps.push({
          step: sweepIndex + 1,
          k,
          prepMs,
          inferMs,
          totalMs,
          workerId,
          boxesFound: boxes.length
        });

        state.chartPoints.push({ sweep: sweepIndex + 1, inferMs, prepMs, totalMs });
        drawLiveChart();
        updateChartStats();

        const pct = Math.round((completedCount / numSteps) * 100);
        els.progressPercent.textContent = `${pct}%`;
        els.progressFill.style.width = `${pct}%`;
        els.progressLabel.textContent = `Завершено: ${completedCount}/${numSteps} срезов`;
        els.bannerSub.textContent = `Обработано ${completedCount}/${numSteps} срезов`;
        els.bannerMetric.textContent = `${totalMs} ms`;
      },
      { signal: state.scanAbortController.signal }
    );

    trace.timings.syncBaseMs = routerRes.syncBaseMs || 0;
    trace.timings.parallelWallMs = Math.round(performance.now() - tParallelStart);
    trace.backendLabel = routerRes.backend;
    trace.routingReason = routerRes.routingReason;

    // 5. WBF слияние рамок
    const tWbf0 = performance.now();
    const fusedBoxes = fuseMultiSpectralBoxes(routerRes.allBoxes, state.extIou, state.extMinHits, numSteps);
    trace.timings.wbfMs = +(performance.now() - tWbf0).toFixed(2);

    // 6. Финальная отрисовка
    const tRen0 = performance.now();
    state.boxes = fusedBoxes;
    renderDisplay();
    updateDetectPill();
    trace.timings.finalRenderMs = +(performance.now() - tRen0).toFixed(2);

    trace.timings.totalWallMs = Math.round(performance.now() - tStartWall);
    state.lastTraceData = trace;

    els.bannerTitle.textContent = `EXTENDED ЗАВЕРШЁН · Угроз: ${fusedBoxes.length}`;
    els.bannerSub.textContent = `${numSteps} спектров · ${routerRes.backend} · ${(trace.timings.totalWallMs / 1000).toFixed(2)} с`;
    els.bannerMetric.textContent = `${trace.timings.totalWallMs} ms`;
    els.bannerSpinner.classList.remove('is-active');

    renderDiagnostics(trace);
  } catch (err) {
    if (err.name === 'AbortError') {
      els.bannerTitle.textContent = 'Анализ остановлен пользователем';
      els.bannerSub.textContent = 'Выберите снимок или запустите другой режим';
    } else {
      console.error('Ошибка Extended анализа:', err);
      els.bannerTitle.textContent = 'Ошибка анализа';
      els.bannerSub.textContent = err.message || String(err);
    }
    els.bannerSpinner.classList.remove('is-active');
  } finally {
    state.scanAbortController = null;
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

// -----------------------------------------------------------------------------
// Отрисовка диагностических таблиц (% Time Breakdown & Per-Sweep Detail)
// -----------------------------------------------------------------------------
function renderDiagnostics(trace) {
  const total = trace.timings.totalWallMs;
  const sweepCount = Math.max(1, trace.sweeps.length);
  els.dbgTotalTime.textContent = `Всего: ${total} ms (~${(total / 1000).toFixed(2)} с)`;

  const sumComputeMs = trace.sweeps.reduce((acc, s) => acc + s.totalMs, 0);
  const usesGpu = trace.sweeps.some(s => typeof s.workerId === 'string' && s.workerId.startsWith('GPU'));
  const speedupText = usesGpu
    ? `Ср. wall-time: ${(trace.timings.parallelWallMs / sweepCount).toFixed(1)} ms/срез`
    : `Сумма CPU-времени: ${sumComputeMs} ms · Ускорение: ${trace.timings.parallelWallMs > 0 ? (sumComputeMs / trace.timings.parallelWallMs).toFixed(1) : '1.0'}x`;

  const polDesc = state.polarityInfo
    ? `Полярность: ${state.polarityInfo.isInverted ? 'Негатив (инвертирован)' : 'Позитив'} (М1:${state.polarityInfo.isNegMethod1 ? 'Нег' : 'Поз'}, М2:${state.polarityInfo.isNegMethod2 ? 'Нег' : 'Поз'}), баланс белого`
    : 'Нормализация отключена или не применялась';

  const items = [
    { name: `Инференс (${trace.backendLabel || `${state.workerCount} воркеров`})`, time: trace.timings.parallelWallMs, color: '#00ADB5', desc: `${trace.routingReason ? trace.routingReason + ' · ' : ''}${speedupText}` },
    { name: 'WBF ансамблирование', time: trace.timings.wbfMs, color: '#EC4899', desc: `Слияние ${sweepCount} срезов в финальные боксы` },
    { name: 'Базовая физическая нормализация', time: trace.timings.basePrepMs, color: '#8B5CF6', desc: polDesc },
    { name: 'Масштабирование (Letterbox 640x640)', time: trace.timings.letterboxScaleMs, color: '#6B7280', desc: 'Подготовка кадра под нейросеть' },
    { name: 'Синхронизация буфера в воркеры', time: trace.timings.syncBaseMs || 0, color: '#10B981', desc: usesGpu ? 'Внутри GPU-батчинга (0 ms в пул)' : 'Передача 640x640 RGBA в память CPU-воркеров' },
    { name: 'Отрисовка UI / Canvas', time: trace.timings.finalRenderMs, color: '#9CA3AF', desc: 'Отрисовка рамок и холста' }
  ];

  els.timelineBar.innerHTML = '';
  items.forEach(it => {
    const pct = total > 0 ? ((it.time / total) * 100).toFixed(1) : 0;
    if (pct > 0.5) {
      const seg = document.createElement('div');
      seg.className = 'timeline-segment';
      seg.style.width = `${pct}%`;
      seg.style.background = it.color;
      seg.dataset.tooltip = `${it.name}: ${Math.round(it.time)} ms (${pct}%)`;
      els.timelineBar.appendChild(seg);
    }
  });

  els.breakdownTbody.innerHTML = '';
  items.forEach(it => {
    const pct = total > 0 ? ((it.time / total) * 100).toFixed(1) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Этап"><span class="time-dot" style="background:${it.color}"></span> <strong>${it.name}</strong></td>
      <td data-label="Суммарно" class="td-time">${Math.round(it.time)} ms</td>
      <td data-label="Доля" class="td-pct">${pct}%</td>
      <td data-label="На 1 срез">${(it.time / sweepCount).toFixed(1)} ms</td>
      <td data-label="Описание" class="td-desc">${it.desc}</td>
    `;
    els.breakdownTbody.appendChild(tr);
  });

  const ks = trace.sweeps.map(s => s.k);
  const minK = ks.length ? Math.min(...ks).toFixed(2) : '0.00';
  const maxK = ks.length ? Math.max(...ks).toFixed(2) : '0.00';
  if (els.sweepsTitle) {
    els.sweepsTitle.textContent = `Журнал спектральных срезов (${sweepCount})`;
  }
  if (els.sweepsSubtitle) {
    els.sweepsSubtitle.textContent = `Диапазон k: ${minK}–${maxK} · Режим: ${trace.mode || 'extended'} · ${trace.backendLabel || 'WASM'}`;
  }

  els.sweepsTbody.innerHTML = '';
  trace.sweeps.forEach(s => {
    const workerLabel = typeof s.workerId === 'number' ? `CPU #${s.workerId}` : String(s.workerId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Срез">#${s.step}</td>
      <td data-label="k_sat"><strong>${s.k.toFixed(3)}</strong></td>
      <td data-label="Вычислитель">${workerLabel}</td>
      <td data-label="Десат + Тензор" class="td-time">${s.prepMs} ms</td>
      <td data-label="Инференс ONNX" class="td-time">${s.inferMs} ms</td>
      <td data-label="Итого срез" class="td-time"><strong>${s.totalMs} ms</strong></td>
      <td data-label="Боксов">${s.boxesFound > 0 ? `<span style="color:#EF4444; font-weight:700;">${s.boxesFound} угроз</span>` : '—'}</td>
    `;
    els.sweepsTbody.appendChild(tr);
  });
}

// -----------------------------------------------------------------------------
// Отрисовка холста, рамок и переключение вкладок
// -----------------------------------------------------------------------------
function updateDetectPill() {
  const pill = els.detectStatusPill;
  const txt = els.detectStatusText;
  const view = state.activeView;

  if (view === 'original') {
    pill.className = 'detection-status detection-status--info';
    txt.textContent = 'Исходный скан (Raw)';
    return;
  }
  if (view === 'normalized') {
    pill.className = 'detection-status detection-status--info';
    txt.textContent = 'Нормализованный (База)';
    return;
  }

  // view === 'detected'
  if (state.boxes && state.boxes.length > 0) {
    pill.className = 'detection-status detection-status--danger';
    txt.textContent = `УГРОЗА ОБНАРУЖЕНА (${state.boxes.length})`;
  } else if (state.lastTraceData) {
    pill.className = 'detection-status detection-status--safe';
    txt.textContent = 'Угроз не обнаружено';
  } else {
    pill.className = 'detection-status';
    txt.textContent = 'Ожидание анализа';
  }
}

function renderDisplay() {
  const canvas = els.displayCanvas;
  const ctx = canvas.getContext('2d');
  const view = state.activeView;

  let srcCanvas = els.originalCanvas;
  if (view === 'normalized' || view === 'detected') {
    srcCanvas = els.normalizedCanvas;
  }

  if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) return;

  canvas.width = srcCanvas.width;
  canvas.height = srcCanvas.height;
  ctx.drawImage(srcCanvas, 0, 0);

  if (view === 'detected' && state.boxes && state.boxes.length > 0) {
    drawBoundingBoxes(ctx, canvas.width, canvas.height);
  }
}

function drawBoundingBoxes(ctx, imgW, imgH) {
  state.boxes.forEach(box => {
    const x = box.x1;
    const y = box.y1;
    const w = box.width;
    const h = box.height;

    // Свечение и красная рамка в неоновом стиле
    ctx.save();
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(3, Math.round(imgW / 350));
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // Заливка полупрозрачным красным
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.fillRect(x, y, w, h);

    // Угловые акценты
    const cornerSize = Math.max(8, Math.min(w, h) * 0.15);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, Math.round(imgW / 450));
    ctx.beginPath();
    ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y);
    ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize);
    ctx.moveTo(x, y + h - cornerSize); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerSize, y + h);
    ctx.moveTo(x + w - cornerSize, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerSize);
    ctx.stroke();

    // Лейбл оружия
    const confPct = (box.conf * 100).toFixed(1);
    const totalSweeps = box.totalSweeps || state.lastTraceData?.sweeps?.length || 1;
    const hitsText = box.detectionsCount ? ` · ${box.detectionsCount}/${totalSweeps} hits` : '';
    const labelText = `⚠ GUN ${confPct}%${hitsText}`;

    const fontSize = Math.max(12, Math.round(imgW / 40));
    ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
    const textW = ctx.measureText(labelText).width;
    const textH = fontSize * 1.35;

    let badgeY = y - textH - 4;
    if (badgeY < 0) badgeY = y + 4;

    ctx.fillStyle = '#EF4444';
    ctx.fillRect(x, badgeY, textW + 12, textH);

    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, x + 6, badgeY + textH / 2);
  });
}

// Переключение режимов отображения
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-selected', 'true');
    state.activeView = btn.dataset.view;
    updateDetectPill();
    renderDisplay();
  });
});

// Одиночный скан (выполняется на CPU-пуле)
async function runSingleScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = 'ОДИНОЧНЫЙ СКАН...';
  els.bannerSub.textContent = 'Инференс 1 среза на ядре CPU (WASM SIMD)...';

  const tStartWall = performance.now();
  const shouldNormalize = !els.normalizeToggle || els.normalizeToggle.checked;

  try {
    const img = state.currentImage;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const t0Prep = performance.now();
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    let basePrep = null;
    if (shouldNormalize) {
      basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }
    const basePrepMs = Math.round(performance.now() - t0Prep);

    const t1Scale = performance.now();
    const dstSize = 640;
    const { rgba: baseRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );
    const letterboxScaleMs = Math.round(performance.now() - t1Scale);

    const tSync0 = performance.now();
    await state.pool.setBaseImage(baseRgba);
    const syncBaseMs = Math.round(performance.now() - tSync0);

    const tInfer0 = performance.now();
    const res = await state.pool.runSingleSweep({
      sweepIndex: 0,
      k: state.normalizer.kSat,
      meta,
      dstSize,
      confThreshold: state.singleConf,
      nmsIouThreshold: state.nmsIouThreshold
    });
    const parallelWallMs = Math.round(performance.now() - tInfer0);

    const tRen0 = performance.now();
    state.boxes = res.boxes;
    renderDisplay();
    updateDetectPill();
    const finalRenderMs = +(performance.now() - tRen0).toFixed(2);
    const totalWallMs = Math.round(performance.now() - tStartWall);

    const trace = {
      mode: 'single',
      backendLabel: 'WASM SIMD (1 воркер)',
      routingReason: `1 ≤ ${state.workerCount * 2} → CPU WASM`,
      startedAt: new Date().toISOString(),
      image: { width: w, height: h, id: state.currentImageId },
      hardware: { cores: state.hardwareCores, workers: 1, crossOriginIsolated: window.crossOriginIsolated },
      polarity: basePrep?.polarity || null,
      timings: { basePrepMs, letterboxScaleMs, syncBaseMs, parallelWallMs, wbfMs: 0, finalRenderMs, totalWallMs },
      sweeps: [{ step: 1, k: state.normalizer.kSat, prepMs: 0, inferMs: res.inferMs, totalMs: res.inferMs, workerId: 0, boxesFound: res.boxes.length }]
    };

    state.lastTraceData = trace;
    state.chartPoints = [{ sweep: 1, inferMs: res.inferMs, prepMs: 0, totalMs: res.inferMs }];
    drawLiveChart();
    updateChartStats();
    renderDiagnostics(trace);

    els.progressPercent.textContent = '100%';
    els.progressFill.style.width = '100%';
    els.progressLabel.textContent = 'Одиночный срез завершён';
    els.bannerSpinner.classList.remove('is-active');
    els.bannerTitle.textContent = `Одиночный скан завершён · Найдено боксов: ${res.boxes.length}`;
    els.bannerSub.textContent = `CPU WASM (1 срез, k=${state.normalizer.kSat.toFixed(2)}): ${res.inferMs} ms · Всего: ${totalWallMs} ms`;
    els.bannerMetric.textContent = `${totalWallMs} ms`;
  } catch (err) {
    console.error('Ошибка одиночного скана:', err);
    els.bannerSpinner.classList.remove('is-active');
    els.bannerTitle.textContent = 'Ошибка одиночного скана';
    els.bannerSub.textContent = err.message || String(err);
  } finally {
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

if (els.btnRunScan) {
  els.btnRunScan.addEventListener('click', () => {
    const mode = els.scanModeSelect ? els.scanModeSelect.value : 'smart';
    if (mode === 'extended') runParallelScan();
    else if (mode === 'single') runSingleScan();
    else runSmartScan();
  });
}

// -----------------------------------------------------------------------------
// Управление пресетами и параметрами сканирования
// -----------------------------------------------------------------------------
function applyPreset(preset) {
  state.extPreset = preset;
  if (preset === 'deep') {
    state.extConf = 0.20;
    state.extSteps = 30;
    state.extMinHits = 2;
    state.extIou = 0.45;
  } else if (preset === 'paranoid') {
    state.extConf = 0.15;
    state.extSteps = 20;
    state.extMinHits = 1;
    state.extIou = 0.45;
  } else if (preset === 'balanced') {
    state.extConf = 0.25;
    state.extSteps = 20;
    state.extMinHits = 2;
    state.extIou = 0.45;
  }
  syncPresetInputs();
  updateRunButtonText();
}

function syncPresetInputs() {
  if (els.extConfRange) els.extConfRange.value = state.extConf;
  if (els.extConfVal) els.extConfVal.textContent = state.extConf.toFixed(2);
  if (els.extStepRange) els.extStepRange.value = state.extSteps;
  if (els.extStepVal) els.extStepVal.textContent = `${state.extSteps} шагов`;
  if (els.extMinHitsRange) els.extMinHitsRange.value = state.extMinHits;
  if (els.extMinHitsVal) els.extMinHitsVal.textContent = `${state.extMinHits} спектра`;
  if (els.extIouRange) els.extIouRange.value = state.extIou;
  if (els.extIouVal) els.extIouVal.textContent = state.extIou.toFixed(2);
  if (els.extPresetSelect) els.extPresetSelect.value = state.extPreset;

  if (els.confRange) els.confRange.value = state.singleConf;
  if (els.confVal) els.confVal.textContent = state.singleConf.toFixed(2);
  if (els.satRange) els.satRange.value = state.normalizer.kSat;
  if (els.satVal) els.satVal.textContent = state.normalizer.kSat.toFixed(2);
  if (els.whiteRange) els.whiteRange.value = state.normalizer.targetWhite;
  if (els.whiteVal) els.whiteVal.textContent = state.normalizer.targetWhite;
}

function updateRunButtonText() {
  if (els.optExtendedMode) {
    els.optExtendedMode.textContent = `▷ Extended (${state.extSteps} спектров)`;
  }
}

// Слушатели пресетов и параметров Extended Mode
if (els.extPresetSelect) {
  els.extPresetSelect.addEventListener('change', (e) => applyPreset(e.target.value));
}
if (els.extConfRange) {
  els.extConfRange.addEventListener('input', (e) => {
    state.extConf = parseFloat(e.target.value);
    els.extConfVal.textContent = state.extConf.toFixed(2);
    state.extPreset = 'custom';
    if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
  });
}
if (els.extStepRange) {
  els.extStepRange.addEventListener('input', (e) => {
    state.extSteps = parseInt(e.target.value, 10);
    els.extStepVal.textContent = `${state.extSteps} шагов`;
    state.extPreset = 'custom';
    if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
    updateRunButtonText();
  });
}
if (els.extIouRange) {
  els.extIouRange.addEventListener('input', (e) => {
    state.extIou = parseFloat(e.target.value);
    els.extIouVal.textContent = state.extIou.toFixed(2);
    state.extPreset = 'custom';
    if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
  });
}
if (els.extMinHitsRange) {
  els.extMinHitsRange.addEventListener('input', (e) => {
    state.extMinHits = parseInt(e.target.value, 10);
    els.extMinHitsVal.textContent = `${state.extMinHits} спектра`;
    state.extPreset = 'custom';
    if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
  });
}

// Слушатели одиночного режима
if (els.confRange) {
  els.confRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    els.confVal.textContent = val.toFixed(2);
    state.singleConf = val;
  });
}
if (els.satRange) {
  els.satRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    els.satVal.textContent = val.toFixed(2);
    state.normalizer.kSat = val;
    if (state.currentImage && (!els.normalizeToggle || els.normalizeToggle.checked)) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      state.normalizer.process(els.normalizedCanvas);
      renderDisplay();
    }
  });
}
if (els.whiteRange) {
  els.whiteRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    els.whiteVal.textContent = val;
    state.normalizer.targetWhite = val;
    if (state.currentImage && (!els.normalizeToggle || els.normalizeToggle.checked)) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      state.normalizer.process(els.normalizedCanvas);
      renderDisplay();
    }
  });
}
if (els.normalizeToggle) {
  els.normalizeToggle.addEventListener('change', () => {
    if (state.currentImage) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      if (els.normalizeToggle.checked) {
        state.normalizer.process(els.normalizedCanvas);
      }
      renderDisplay();
    }
  });
}

// Копирование лога трассировки
if (els.btnCopyTrace) {
  els.btnCopyTrace.addEventListener('click', () => {
    if (!state.lastTraceData) {
      alert('Сначала выполните анализ для генерации трассировки!');
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(state.lastTraceData, null, 2))
      .then(() => alert('Трассировка скопирована в буфер обмена!'))
      .catch(e => console.error('Ошибка буфера:', e));
  });
}

// Переключение темы
if (els.themeBtn) {
  els.themeBtn.addEventListener('click', () => {
    const cur = document.body.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    els.themeIcon.textContent = next === 'dark' ? '🌙' : '☀️';
  });
}

function updateAccelBadge() {
  if (!els.accelProfileVal) return;
  const threshold = state.workerCount * state.gpuFramesPerCore;
  if (state.gpuExecutor && state.gpuExecutor.isReady) {
    const layoutTag = state.gpuExecutor.preferredLayout || 'auto';
    els.accelProfileVal.textContent = `WebGPU · B=${state.gpuExecutor.batchSize} (${layoutTag}/${state.gpuExecutor.optLevel})`;
    els.hardwareStatus.textContent = `GPU B=${state.gpuExecutor.batchSize} + ${state.workerCount} CPU`;
  } else {
    els.accelProfileVal.textContent = `WASM SIMD · ${state.workerCount} воркеров`;
    els.hardwareStatus.textContent = `WASM (${state.workerCount} ядер)`;
  }
  if (els.coresModeBadge) {
    els.coresModeBadge.textContent = `${state.workerCount} CPU · GPU > ${threshold} кадров`;
  }
}

// Загрузка файлов (click + drag & drop)
if (els.dropzone && els.fileInput) {
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleCustomFile(e.target.files[0]);
    e.target.value = '';
  });
  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('is-dragover');
  });
  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('is-dragover');
  });
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('is-dragover');
    if (e.dataTransfer?.files?.[0]) handleCustomFile(e.dataTransfer.files[0]);
  });
}

// Научные гиперпараметры (Research Lab)
if (els.smoothingSelect) {
  els.smoothingSelect.addEventListener('change', (e) => {
    state.imageSmoothingQuality = e.target.value;
  });
}
if (els.nmsIouRange) {
  els.nmsIouRange.addEventListener('input', (e) => {
    state.nmsIouThreshold = parseFloat(e.target.value);
    if (els.nmsIouVal) els.nmsIouVal.textContent = state.nmsIouThreshold.toFixed(2);
  });
}
if (els.smartStage1Range) {
  els.smartStage1Range.addEventListener('input', (e) => {
    state.smartMaxStage1 = parseInt(e.target.value, 10);
    if (els.smartStage1Val) els.smartStage1Val.textContent = String(state.smartMaxStage1);
  });
}
if (els.smartWhisperRange) {
  els.smartWhisperRange.addEventListener('input', (e) => {
    state.smartWhisperConf = parseFloat(e.target.value);
    if (els.smartWhisperVal) els.smartWhisperVal.textContent = state.smartWhisperConf.toFixed(2);
  });
}
if (els.distThreshRange) {
  els.distThreshRange.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    state.normalizer.distThresh = v;
    if (els.distThreshVal) els.distThreshVal.textContent = String(v);
    if (state.currentImage && (!els.normalizeToggle || els.normalizeToggle.checked)) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      state.normalizer.process(els.normalizedCanvas);
      renderDisplay();
    }
  });
}
if (els.gpuFramesPerCoreRange) {
  els.gpuFramesPerCoreRange.addEventListener('input', (e) => {
    state.gpuFramesPerCore = parseInt(e.target.value, 10);
    if (els.gpuFramesPerCoreVal) els.gpuFramesPerCoreVal.textContent = String(state.gpuFramesPerCore);
    updateAccelBadge();
  });
}

function updateGridStepLabel() {
  if (!els.gridStepVal) return;
  const grid = generateKSweepGrid({ margin: state.gridMargin, step: state.gridStep });
  els.gridStepVal.textContent = `${state.gridStep.toFixed(2)} (${grid.length} кадров)`;
}

if (els.gridMarginRange) {
  els.gridMarginRange.addEventListener('input', (e) => {
    state.gridMargin = parseFloat(e.target.value);
    if (els.gridMarginVal) els.gridMarginVal.textContent = state.gridMargin.toFixed(2);
    updateGridStepLabel();
  });
}

if (els.gridStepRange) {
  els.gridStepRange.addEventListener('input', (e) => {
    state.gridStep = parseFloat(e.target.value);
    updateGridStepLabel();
  });
}

/**
 * Запуск калибровки ускорения с нативным <dialog> и проверкой паритета GPU vs WASM
 */
async function runDeviceCalibration() {
  if (!state.gpuExecutor) {
    state.gpuExecutor = new WebGPUExecutor(DYNAMIC_MODEL_PATH);
  }
  state.calibAbortController = new AbortController();

  if (els.calibModal) {
    if (els.calibProgressFill) els.calibProgressFill.style.width = '5%';
    if (els.calibModalSub) els.calibModalSub.textContent = 'Подготовка эталонного теста GPU vs WASM...';
    if (!els.calibModal.open) els.calibModal.showModal();
  }

  try {
    let refInput1x = null;
    try {
      refInput1x = await loadReferenceChw('../samples/image9.png', 0.42, 640);
    } catch {
      refInput1x = null;
    }

    const profile = await state.gpuExecutor.calibrate({
      signal: state.calibAbortController.signal,
      refInput1x,
      onStep: (pct, msg) => {
        if (els.calibProgressFill) els.calibProgressFill.style.width = `${pct}%`;
        if (els.calibModalSub) els.calibModalSub.textContent = msg;
      }
    });
    console.log('[Accel Calibration] Профиль сохранён:', profile);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Accel Calibration] Калибровка прекращена пользователем. Используем WASM-пул.');
      state.gpuExecutor.isReady = false;
    } else {
      console.error('[Accel Calibration] Ошибка калибровки:', err);
      state.gpuExecutor.isReady = false;
    }
  } finally {
    state.calibAbortController = null;
    if (els.calibModal && els.calibModal.open) els.calibModal.close();
    updateAccelBadge();
  }
}

if (els.btnCancelCalib) {
  els.btnCancelCalib.addEventListener('click', () => {
    if (state.calibAbortController) {
      state.calibAbortController.abort();
    }
    if (els.calibModal && els.calibModal.open) els.calibModal.close();
  });
}

if (els.btnCancelGpuWork) {
  els.btnCancelGpuWork.addEventListener('click', () => {
    if (state.scanAbortController) {
      state.scanAbortController.abort();
    }
    if (els.gpuWorkModal && els.gpuWorkModal.open) els.gpuWorkModal.close();
  });
}

if (els.btnRunCalibration) {
  els.btnRunCalibration.addEventListener('click', async () => {
    if (state.isScanning) return;
    await runDeviceCalibration();
  });
}

if (els.btnResetCalib) {
  els.btnResetCalib.addEventListener('click', () => {
    WebGPUExecutor.clearSavedProfile();
    if (state.gpuExecutor) state.gpuExecutor.isReady = false;
    updateAccelBadge();
  });
}

/**
 * Единый роутер исполнения срезов:
 * - Если кадров > (2 × число CPU-воркеров) И WebGPU откалиброван и прошёл паритет -> WebGPU с оверлеем + ETA
 * - Иначе -> многоядерный WASM-пул (batch=1 на воркер)
 */
async function executeSweepsWithRouter(baseRgba, tasks, onSweepBusy, onSweepDone, { signal } = {}) {
  const gpuFrameThreshold = state.workerCount * state.gpuFramesPerCore;
  const shouldUseGpu = tasks.length > gpuFrameThreshold && state.gpuExecutor && state.gpuExecutor.isReady;

  if (shouldUseGpu) {
    const routingReason = `${tasks.length} кадров > ${gpuFrameThreshold} (2×${state.workerCount} CPU) → WebGPU`;
    const runGpuWithOverlay = async () => {
      if (els.gpuWorkModal) {
        if (els.gpuWorkProgressFill) els.gpuWorkProgressFill.style.width = '4%';
        if (els.gpuWorkSub) els.gpuWorkSub.textContent = `Запуск ${tasks.length} срезов на GPU (batch=${state.gpuExecutor.batchSize})...`;
        if (els.gpuWorkEta) els.gpuWorkEta.textContent = 'ETA: замер первого батча...';
        if (!els.gpuWorkModal.open) els.gpuWorkModal.showModal();
      }
      try {
        return await state.gpuExecutor.runBatchedSweeps(
          baseRgba,
          tasks,
          (info) => {
            if (onSweepDone) {
              onSweepDone(info.workerId, info.sweepIndex, info.k, info.prepMs, info.inferMs, info.totalMs, info.boxes, 0);
            }
          },
          {
            signal,
            onBatchProgress: ({ batchIdx, totalBatches, doneSlices, totalSlices, batchMs, etaSec }) => {
              if (!els.gpuWorkModal) return;
              const pct = Math.max(4, Math.round((doneSlices / totalSlices) * 100));
              if (els.gpuWorkProgressFill) els.gpuWorkProgressFill.style.width = `${pct}%`;
              if (els.gpuWorkSub) {
                els.gpuWorkSub.textContent = `Батч ${batchIdx}/${totalBatches} · срезы ${doneSlices}/${totalSlices}`;
              }
              if (els.gpuWorkEta) {
                els.gpuWorkEta.textContent = etaSec === null
                  ? 'ETA: замер первого батча...'
                  : `ETA: ~${etaSec.toFixed(1)} с (${batchMs} мс/батч)`;
              }
            }
          }
        );
      } finally {
        if (els.gpuWorkModal && els.gpuWorkModal.open) els.gpuWorkModal.close();
      }
    };

    try {
      const res = await runGpuWithOverlay();
      return {
        allBoxes: res.allBoxes,
        maxRawConf: res.maxRawConf,
        syncBaseMs: 0,
        usedGpu: true,
        routingReason,
        backend: `WebGPU (batch=${state.gpuExecutor.batchSize})`
      };
    } catch (gpuErr) {
      if (gpuErr.name === 'AbortError') throw gpuErr;
      console.warn('Ошибка WebGPU во время инференса, пробуем откат:', gpuErr);
      if (state.gpuExecutor.batchSize > 2) {
        try {
          state.gpuExecutor.batchSize = 2;
          await state.gpuExecutor.createSession({ optLevel: state.gpuExecutor.optLevel, preferredLayout: state.gpuExecutor.preferredLayout });
          state.gpuExecutor.isReady = true;
          const res2 = await runGpuWithOverlay();
          WebGPUExecutor.saveProfile({
            backend: 'webgpu',
            batchSize: 2,
            optLevel: state.gpuExecutor.optLevel,
            preferredLayout: state.gpuExecutor.preferredLayout,
            adapterInfo: state.gpuExecutor.adapterInfo,
            calibratedAt: Date.now()
          });
          updateAccelBadge();
          return {
            allBoxes: res2.allBoxes,
            maxRawConf: res2.maxRawConf,
            syncBaseMs: 0,
            usedGpu: true,
            routingReason: `${routingReason} (откат B=2)`,
            backend: 'WebGPU (batch=2, откат)'
          };
        } catch (err2) {
          if (err2.name === 'AbortError') throw err2;
          console.warn('Откат WebGPU на batch=2 не удался, переключаемся на WASM-пул:', err2);
        }
      }
      state.gpuExecutor.isReady = false;
      updateAccelBadge();
    }
  }

  // Fallback или <= 2 кадров на воркер: многоядерный WASM-пул (batch=1 на воркер)
  const cpuReason = tasks.length <= gpuFrameThreshold
    ? `${tasks.length} кадров ≤ ${gpuFrameThreshold} (2×${state.workerCount}) → CPU WASM`
    : 'WebGPU недоступен → CPU WASM';
  const tSync0 = performance.now();
  await state.pool.setBaseImage(baseRgba);
  const syncBaseMs = Math.round(performance.now() - tSync0);

  let maxRawConf = 0;
  const allBoxes = await state.pool.runParallelSweeps(
    tasks,
    onSweepBusy,
    (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes, sliceMaxRaw) => {
      if (sliceMaxRaw > maxRawConf) maxRawConf = sliceMaxRaw;
      if (onSweepDone) onSweepDone(workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes, sliceMaxRaw);
    }
  );
  return {
    allBoxes,
    maxRawConf,
    syncBaseMs,
    usedGpu: false,
    routingReason: cpuReason,
    backend: `WASM SIMD (${state.workerCount} воркеров)`
  };
}

/**
 * Режим SMART:
 * 1. Строит равномерную сетку k_sat с отступом margin (0.10) и шагом step (0.05 -> 17 кадров)
 * 2. Этап 1: гонит 10 опорных срезов (без повторного прогона на Этапе 2)
 * 3. Этап 2:
 *    - если найдены боксы -> исследует только соседние не проверенные k вокруг найденных
 *    - если ничего не найдено -> догоняет только оставшиеся непроверенные кадры сетки
 */
async function runSmartScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  state.scanAbortController = new AbortController();

  const img = state.currentImage;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const shouldNormalize = !els.normalizeToggle || els.normalizeToggle.checked;

  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');

  state.chartPoints = [];
  drawLiveChart();

  const fullGrid = generateKSweepGrid({ margin: state.gridMargin, step: state.gridStep });
  const stage1Limit = Math.max(2, state.smartMaxStage1 || 10);
  const stage1Indices = new Set();
  if (fullGrid.length <= stage1Limit) {
    fullGrid.forEach((_, idx) => stage1Indices.add(idx));
  } else {
    for (let i = 0; i < stage1Limit; i++) {
      const idx = Math.round((i * (fullGrid.length - 1)) / (stage1Limit - 1));
      stage1Indices.add(idx);
    }
  }
  const stage1K = Array.from(stage1Indices).map(idx => fullGrid[idx]);
  // Обязательный ч/б якорь k=0.00 для нестандартных цветовых схем/рисунков
  if (!stage1K.some(v => Math.abs(v) < 1e-4)) {
    stage1K.unshift(0);
  }

  els.bannerTitle.textContent = `SMART: ЭТАП 1 (${stage1K.length} опорных срезов)...`;
  els.bannerSub.textContent = `Сетка [${state.gridMargin.toFixed(2)}..${(1 - state.gridMargin).toFixed(2)}], шаг ${state.gridStep.toFixed(2)} (${fullGrid.length} в сетке)`;
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';
  els.progressLabel.textContent = `Этап 1: 0/${stage1K.length}`;

  const trace = {
    mode: 'smart',
    backendLabel: '',
    routingReason: '',
    startedAt: new Date().toISOString(),
    image: { width: w, height: h, id: state.currentImageId },
    hardware: {
      cores: state.hardwareCores,
      workers: state.workerCount,
      gpuReady: !!(state.gpuExecutor && state.gpuExecutor.isReady),
      gpuBatch: state.gpuExecutor?.batchSize || 1,
      crossOriginIsolated: window.crossOriginIsolated
    },
    timings: { basePrepMs: 0, letterboxScaleMs: 0, syncBaseMs: 0, parallelWallMs: 0, wbfMs: 0, finalRenderMs: 0, totalWallMs: 0 },
    sweeps: []
  };

  const tStartWall = performance.now();

  try {
    const t0 = performance.now();
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    if (shouldNormalize) {
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
      trace.polarity = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }
    trace.timings.basePrepMs = Math.round(performance.now() - t0);

    const t1 = performance.now();
    const dstSize = 640;
    const { rgba: baseSweepRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );
    trace.timings.letterboxScaleMs = Math.round(performance.now() - t1);

    const stage1Tasks = stage1K.map((k, idx) => ({
      sweepIndex: idx,
      k,
      meta,
      dstSize,
      confThreshold: state.extConf,
      nmsIouThreshold: state.nmsIouThreshold
    }));

    const tInf0 = performance.now();
    let completed = 0;
    const hitKs = [];

    const onDone = (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes, sliceMaxRaw = 0) => {
      completed++;
      if (typeof workerId === 'number') setCoreIdle(workerId, totalMs);
      const isWhisper = state.smartWhisperConf > 0 && sliceMaxRaw >= state.smartWhisperConf;
      if (boxes.length > 0 || isWhisper) hitKs.push(k);

      trace.sweeps.push({ step: trace.sweeps.length + 1, k, prepMs, inferMs, totalMs, workerId, boxesFound: boxes.length });
      state.chartPoints.push({ sweep: trace.sweeps.length, inferMs, prepMs, totalMs });
      drawLiveChart();
      updateChartStats();

      const pct = Math.round((completed / stage1Tasks.length) * 50);
      els.progressPercent.textContent = `${pct}%`;
      els.progressFill.style.width = `${pct}%`;
      els.progressLabel.textContent = `Этап 1: ${completed}/${stage1Tasks.length}`;
      els.bannerMetric.textContent = `${totalMs} ms`;
    };

    const res1 = await executeSweepsWithRouter(
      baseSweepRgba,
      stage1Tasks,
      (workerId, sweepIndex, k) => setCoreBusy(workerId, sweepIndex, k),
      onDone,
      { signal: state.scanAbortController.signal }
    );
    trace.timings.syncBaseMs += res1.syncBaseMs || 0;

    const allBoxes = [...res1.allBoxes];
    const usedKSet = new Set(stage1K.map(v => v.toFixed(3)));
    let stage2K = [];
    let stage2Reason = '';

    if (hitKs.length > 0) {
      stage2Reason = `Найдено в ${hitKs.length} из ${stage1K.length} → уточнение соседей`;
      const halfStep = parseFloat((state.gridStep / 2).toFixed(3));
      const fullStep = state.gridStep;
      const offsets = [-fullStep, -halfStep, halfStep, fullStep];

      const neighborSet = new Set();
      hitKs.forEach(hk => {
        offsets.forEach(off => {
          const nk = parseFloat(Math.min(1.0, Math.max(0.0, hk + off)).toFixed(3));
          if (!usedKSet.has(nk.toFixed(3))) {
            neighborSet.add(nk);
          }
        });
      });
      stage2K = Array.from(neighborSet).sort((a, b) => a - b);
    } else {
      stage2Reason = `На первых ${stage1K.length} пусто → добор оставшихся`;
      stage2K = fullGrid.filter(k => !usedKSet.has(k.toFixed(3)));
    }

    let res2Backend = null;
    if (stage2K.length > 0) {
      els.bannerTitle.textContent = `SMART: ЭТАП 2 (+${stage2K.length} срезов)...`;
      els.bannerSub.textContent = `${stage2Reason} (+${stage2K.length})`;

      const stage2Tasks = stage2K.map((k, idx) => ({
        sweepIndex: stage1Tasks.length + idx,
        k,
        meta,
        dstSize,
        confThreshold: state.extConf,
        nmsIouThreshold: state.nmsIouThreshold
      }));

      let completed2 = 0;
      const res2 = await executeSweepsWithRouter(
        baseSweepRgba,
        stage2Tasks,
        (workerId, sweepIndex, k) => setCoreBusy(workerId, sweepIndex, k),
        (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes) => {
          completed2++;
          if (typeof workerId === 'number') setCoreIdle(workerId, totalMs);

          trace.sweeps.push({ step: trace.sweeps.length + 1, k, prepMs, inferMs, totalMs, workerId, boxesFound: boxes.length });
          state.chartPoints.push({ sweep: trace.sweeps.length, inferMs, prepMs, totalMs });
          drawLiveChart();
          updateChartStats();

          const pct = 50 + Math.round((completed2 / stage2Tasks.length) * 50);
          els.progressPercent.textContent = `${pct}%`;
          els.progressFill.style.width = `${pct}%`;
          els.progressLabel.textContent = `Этап 2: ${completed2}/${stage2Tasks.length}`;
          els.bannerMetric.textContent = `${totalMs} ms`;
        },
        { signal: state.scanAbortController.signal }
      );
      trace.timings.syncBaseMs += res2.syncBaseMs || 0;
      res2Backend = res2.backend;
      res2.allBoxes.forEach(b => allBoxes.push(b));
    }

    trace.timings.parallelWallMs = Math.round(performance.now() - tInf0);
    trace.backendLabel = res2Backend && res2Backend !== res1.backend
      ? `${res1.backend} + ${res2Backend}`
      : res1.backend;
    trace.routingReason = `Этап 1: ${stage1K.length} (${res1.routingReason}), Этап 2: +${stage2K.length}`;

    const totalEvaluated = stage1K.length + stage2K.length;
    const tWbf0 = performance.now();
    const fusedBoxes = fuseMultiSpectralBoxes(allBoxes, state.extIou, state.extMinHits, totalEvaluated);
    trace.timings.wbfMs = +(performance.now() - tWbf0).toFixed(2);

    const tRen0 = performance.now();
    state.boxes = fusedBoxes;
    renderDisplay();
    updateDetectPill();
    trace.timings.finalRenderMs = +(performance.now() - tRen0).toFixed(2);

    trace.timings.totalWallMs = Math.round(performance.now() - tStartWall);
    state.lastTraceData = trace;

    els.progressPercent.textContent = '100%';
    els.progressFill.style.width = '100%';
    els.progressLabel.textContent = `Готово: ${stage1K.length} + ${stage2K.length} = ${totalEvaluated} срезов`;
    els.bannerTitle.textContent = `SMART ЗАВЕРШЁН · Угроз: ${fusedBoxes.length} (${stage1K.length}+${stage2K.length} срезов)`;
    els.bannerSub.textContent = `${stage2Reason} · ${trace.backendLabel} · ${(trace.timings.totalWallMs / 1000).toFixed(2)} с`;
    els.bannerMetric.textContent = `${trace.timings.totalWallMs} ms`;
    els.bannerSpinner.classList.remove('is-active');

    renderDiagnostics(trace);
  } catch (err) {
    if (err.name === 'AbortError') {
      els.bannerTitle.textContent = 'Smart-сканирование остановлено';
      els.bannerSub.textContent = 'Прервано пользователем';
    } else {
      console.error('Ошибка Smart-сканирования:', err);
      els.bannerTitle.textContent = 'Ошибка Smart-сканирования';
      els.bannerSub.textContent = err.message || String(err);
    }
    els.bannerSpinner.classList.remove('is-active');
  } finally {
    state.scanAbortController = null;
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

// -----------------------------------------------------------------------------
// Главная точка входа
// -----------------------------------------------------------------------------
async function init() {
  setupCoresGrid();
  drawLiveChart();
  buildCarousel();
  syncPresetInputs();
  updateGridStepLabel();
  updateRunButtonText();

  try {
    els.hardwareStatus.textContent = `Запуск пула ${state.workerCount} воркеров...`;
    els.statusDot.classList.add('status-dot--loading');

    state.pool = new ParallelWorkerPool(state.workerCount, DYNAMIC_MODEL_PATH);
    await state.pool.init((ready, total) => {
      els.hardwareStatus.textContent = `Воркеры: ${ready}/${total}...`;
    });

    state.gpuExecutor = new WebGPUExecutor(DYNAMIC_MODEL_PATH);
    const savedProfile = WebGPUExecutor.getSavedProfile();
    if (!savedProfile) {
      await runDeviceCalibration();
    } else if (savedProfile.backend === 'webgpu') {
      els.hardwareStatus.textContent = 'Восстановление WebGPU...';
      await state.gpuExecutor.initFromProfile(savedProfile);
    }

    updateAccelBadge();
    els.statusDot.classList.remove('status-dot--loading');
    els.bannerTitle.textContent = `Движок готов · ${els.accelProfileVal ? els.accelProfileVal.textContent : 'OK'}`;
    els.bannerSub.textContent = 'Выберите снимок и запустите Smart / Extended / Single анализ';

    if (SAMPLES.length > 0) {
      await loadSample(SAMPLES[0]);
      // Автозапуск первого снимка в режиме Smart
      runSmartScan();
    }
  } catch (err) {
    console.error('Ошибка инициализации пула воркеров:', err);
    els.hardwareStatus.textContent = 'Ошибка воркеров';
    els.statusDot.style.background = '#EF4444';
    els.statusDot.classList.remove('status-dot--loading');
    els.bannerTitle.textContent = 'Ошибка инициализации';
    els.bannerSub.textContent = err.message || String(err);
  }
}

init();
