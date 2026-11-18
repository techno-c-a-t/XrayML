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

const SAMPLES = [
  { id: 'image2', name: 'Снимок 2 (Оружие)', path: '../samples/image2.jpg' },
  { id: 'image9', name: 'Снимок 9 (Оружие)', path: '../samples/image9.png' },
  { id: 'image10', name: 'Снимок 10 (Оружие)', path: '../samples/image10.png' },
  { id: 'image1', name: 'Снимок 1', path: '../samples/image1.jpg' },
  { id: 'image3', name: 'Снимок 3', path: '../samples/image3.png' }
];

// Динамический расчет числа параллельных воркеров
const HARDWARE_CORES = navigator.hardwareConcurrency || 4;
const WORKER_COUNT = HARDWARE_CORES <= 4 ? Math.max(1, HARDWARE_CORES - 1) : HARDWARE_CORES - 2;

const state = {
  normalizer: new XrayNormalizer(),
  detector: new YoloDetector({ modelPath: '../models/best.onnx', confThreshold: 0.20 }),
  pool: null,
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
  // Настройки Single Mode
  singleConf: 0.35
};
window.state = state;

const els = {
  hardwareStatus: document.getElementById('hardwareStatus'),
  statusDot: document.getElementById('statusDot'),
  themeBtn: document.getElementById('themeBtn'),
  themeIcon: document.getElementById('themeIcon'),
  samplesCarousel: document.getElementById('samplesCarousel'),
  btnRunExtended: document.getElementById('btnRunExtended'),
  btnRunSingle: document.getElementById('btnRunSingle'),
  btnCopyTrace: document.getElementById('btnCopyTrace'),
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
  // Breakdown
  dbgTotalTime: document.getElementById('dbgTotalTime'),
  timelineBar: document.getElementById('timelineBar'),
  breakdownTbody: document.getElementById('breakdownTbody'),
  sweepsTbody: document.getElementById('sweepsTbody')
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
    const promises = [];

    for (let i = 0; i < this.size; i++) {
      const p = new Promise((resolve, reject) => {
        const w = new Worker('./debug-worker.js?v=13');
        w.workerId = i;

        const onInitMsg = (evt) => {
          const { type, workerId, error } = evt.data;
          if (type === 'ready') {
            w.removeEventListener('message', onInitMsg);
            readyCount++;
            if (onProgress) onProgress(readyCount, this.size);
            this.idleWorkers.push(w);
            resolve(w);
          } else if (type === 'error') {
            w.removeEventListener('message', onInitMsg);
            reject(new Error(`Воркер #${workerId} ошибка: ${error}`));
          }
        };

        w.addEventListener('message', onInitMsg);
        w.onerror = (err) => {
          reject(new Error(`Сбой скрипта воркера #${i}: ${err.message}`));
        };

        w.postMessage({ type: 'init', payload: { workerId: i, modelPath: this.modelPath } });
        this.workers.push(w);
      });
      promises.push(p);
    }

    await Promise.all(promises);
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
              if (onSweepDone) onSweepDone(data.workerId, data.sweepIndex, data.k, data.prepMs, data.inferMs, data.totalMs, data.boxes);
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

  els.coresModeBadge.textContent = `${workers} активных воркеров · ${totalCores} ядер CPU`;
  els.activeThreadsBadge.textContent = `${workers} воркеров (из ${totalCores} ядер)`;
  els.poolDescText.textContent = `Вычисление 30 срезов спектра распределяется на ${workers} параллельных ядер (WASM SIMD, 1 поток на воркер). Оставшиеся ${totalCores - workers} ядра зарезервированы под плавную отрисовку UI и систему.`;
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
  const stepX = w / Math.max(30, points.length);

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
// Карусель и загрузка снимков
// -----------------------------------------------------------------------------
function buildCarousel() {
  els.samplesCarousel.innerHTML = '';
  SAMPLES.forEach((sample, idx) => {
    const btn = document.createElement('div');
    btn.className = `sample-thumb ${sample.id === state.currentImageId ? 'is-active' : ''}`;
    btn.dataset.id = sample.id;
    btn.setAttribute('role', 'tab');
    btn.innerHTML = `
      <img src="${sample.path}" alt="${sample.name}">
      <span class="sample-tag">#${idx + 1}</span>
    `;
    btn.addEventListener('click', () => {
      if (state.isScanning) return;
      document.querySelectorAll('.sample-thumb').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      loadSample(sample);
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

// -----------------------------------------------------------------------------
// ПАРАЛЛЕЛЬНЫЙ ПРОФИЛИРОВАННЫЙ АНАЛИЗ (30 СРЕЗОВ НА ПУЛЕ ВОРКЕРОВ)
// -----------------------------------------------------------------------------
async function runParallelScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;

  const img = state.currentImage;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  els.btnRunExtended.disabled = true;
  els.btnRunSingle.disabled = true;
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = `ИДЕТ ПАРАЛЛЕЛЬНЫЙ АНАЛИЗ (${state.extSteps} СПЕКТРОВ)...`;
  els.bannerSub.textContent = `Параллельный расчет на ${state.workerCount} ядрах CPU одновременно...`;
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';
  els.progressLabel.textContent = 'Инициализация срезов...';

  state.chartPoints = [];
  drawLiveChart();

  const trace = {
    startedAt: new Date().toISOString(),
    image: { width: w, height: h, id: state.currentImageId },
    hardware: {
      cores: state.hardwareCores,
      workers: state.workerCount,
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
    const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
    state.polarityInfo = basePrep.polarity;
    trace.timings.basePrepMs = Math.round(performance.now() - t0);
    trace.polarity = basePrep.polarity;

    // 2. Масштабирование до 640x640 для спектрального анализа
    const t1 = performance.now();
    const dstSize = 640;
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
    sweepCtx.fillStyle = '#727272';
    sweepCtx.fillRect(0, 0, dstSize, dstSize);
    sweepCtx.drawImage(els.normalizedCanvas, 0, 0, w, h, padX, padY, newW, newH);

    const baseSweepImgData = sweepCtx.getImageData(0, 0, dstSize, dstSize);
    trace.timings.letterboxScaleMs = Math.round(performance.now() - t1);

    // 3. Синхронизация базового кадра во все воркеры пула (<10ms)
    const tSync0 = performance.now();
    await state.pool.setBaseImage(baseSweepImgData.data);
    trace.timings.syncBaseMs = Math.round(performance.now() - tSync0);

    // 4. Формирование пула задач (десатурация и тензоры строятся параллельно на ядрах!)
    const numSteps = state.extSteps;
    const stepSize = numSteps > 1 ? 0.95 / (numSteps - 1) : 0;
    const tasks = [];
    for (let i = 0; i < numSteps; i++) {
      const k = parseFloat((i * stepSize).toFixed(3));
      tasks.push({ sweepIndex: i, k, meta, dstSize, confThreshold: state.extConf });
    }

    // 5. ЗАПУСК ПАРАЛЛЕЛЬНОГО ПУЛА ИНФЕРЕНСА НА ВЫДЕЛЕННЫХ ЯДРАХ
    const tParallelStart = performance.now();
    let completedCount = 0;

    const allBoxes = await state.pool.runParallelSweeps(
      tasks,
      (workerId, sweepIndex, k) => {
        setCoreBusy(workerId, sweepIndex, k);
      },
      (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes) => {
        completedCount++;
        setCoreIdle(workerId, totalMs);

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
        els.bannerSub.textContent = `Параллельный инференс: ${completedCount}/${numSteps} срезов завершено на ${state.workerCount} ядрах`;
        els.bannerMetric.textContent = `${totalMs} ms`;
      }
    );

    trace.timings.parallelWallMs = Math.round(performance.now() - tParallelStart);

    // 6. WBF слияние рамок
    const tWbf0 = performance.now();
    const fusedBoxes = fuseMultiSpectralBoxes(allBoxes, state.extIou, state.extMinHits, numSteps);
    trace.timings.wbfMs = +(performance.now() - tWbf0).toFixed(2);

    // 7. Финальная отрисовка
    const tRen0 = performance.now();
    state.boxes = fusedBoxes;
    renderDisplay();
    updateDetectPill();
    trace.timings.finalRenderMs = +(performance.now() - tRen0).toFixed(2);

    trace.timings.totalWallMs = Math.round(performance.now() - tStartWall);
    state.lastTraceData = trace;

    // Баннер результата
    els.bannerTitle.textContent = `АНАЛИЗ ЗАВЕРШЕН · Найдено угроз: ${fusedBoxes.length}`;
    els.bannerSub.textContent = `${numSteps} спектров обработано параллельно на ${state.workerCount} ядрах за ${(trace.timings.totalWallMs / 1000).toFixed(2)} с`;
    els.bannerMetric.textContent = `${trace.timings.totalWallMs} ms`;
    els.bannerSpinner.classList.remove('is-active');

    renderDiagnostics(trace);
  } finally {
    state.isScanning = false;
    els.btnRunExtended.disabled = false;
    els.btnRunSingle.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Отрисовка диагностических таблиц (% Time Breakdown & Per-Sweep Detail)
// -----------------------------------------------------------------------------
function renderDiagnostics(trace) {
  const total = trace.timings.totalWallMs;
  els.dbgTotalTime.textContent = `Всего: ${total} ms (~${(total / 1000).toFixed(2)} с)`;

  const sumComputeMs = trace.sweeps.reduce((acc, s) => acc + s.totalMs, 0);
  const speedup = trace.timings.parallelWallMs > 0 ? (sumComputeMs / trace.timings.parallelWallMs).toFixed(1) : '1.0';

  const polDesc = state.polarityInfo
    ? `Полярность: ${state.polarityInfo.isInverted ? 'Негатив (инвертирован)' : 'Позитив'} (Метод 1: ${state.polarityInfo.isNegMethod1 ? 'Нег' : 'Поз'}, Метод 2: ${state.polarityInfo.isNegMethod2 ? 'Нег' : 'Поз'}), баланс белого`
    : 'Двухалгоритмичная полярность, баланс белого';

  const items = [
    { name: `Параллельный расчет (${state.workerCount} ядер)`, time: trace.timings.parallelWallMs, color: '#00ADB5', desc: `Суммарный объем вычислений: ${sumComputeMs} ms · Реальное ускорение: ${speedup}x` },
    { name: 'WBF ансамблирование', time: trace.timings.wbfMs, color: '#EC4899', desc: 'Слияние срезов в финальные боксы угроз' },
    { name: 'Базовая физическая нормализация', time: trace.timings.basePrepMs, color: '#8B5CF6', desc: polDesc },
    { name: 'Масштабирование (Letterbox 640x640)', time: trace.timings.letterboxScaleMs, color: '#6B7280', desc: 'Подготовка кадра под нейросеть' },
    { name: 'Синхронизация буфера в ядра', time: trace.timings.syncBaseMs, color: '#10B981', desc: 'Передача 640x640 RGBA в память воркеров' },
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
      <td><span class="time-dot" style="background:${it.color}"></span> <strong>${it.name}</strong></td>
      <td class="td-time">${Math.round(it.time)} ms</td>
      <td class="td-pct">${pct}%</td>
      <td>${(it.time / 30).toFixed(1)} ms</td>
      <td class="td-desc">${it.desc}</td>
    `;
    els.breakdownTbody.appendChild(tr);
  });

  els.sweepsTbody.innerHTML = '';
  trace.sweeps.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${s.step}</td>
      <td><strong>${s.k.toFixed(3)}</strong></td>
      <td>Ядро #${s.workerId}</td>
      <td class="td-time">${s.prepMs} ms</td>
      <td class="td-time">${s.inferMs} ms</td>
      <td class="td-time"><strong>${s.totalMs} ms</strong></td>
      <td>${s.boxesFound > 0 ? `<span style="color:#EF4444; font-weight:700;">${s.boxesFound} угроз</span>` : '—'}</td>
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
    const totalSweeps = box.totalSweeps || 30;
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

// Кнопка одиночного скана (выполняется на ядре #0 пула)
els.btnRunSingle.addEventListener('click', async () => {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = 'ОДИНОЧНЫЙ СКАН...';
  els.bannerSub.textContent = 'Инференс 1 среза на ядре CPU...';

  try {
    const img = state.currentImage;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const dstSize = 640;
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
    sweepCtx.fillStyle = '#727272';
    sweepCtx.fillRect(0, 0, dstSize, dstSize);
    sweepCtx.drawImage(els.normalizedCanvas, 0, 0, w, h, padX, padY, newW, newH);

    const baseData = sweepCtx.getImageData(0, 0, dstSize, dstSize);
    await state.pool.setBaseImage(baseData.data);

    const t0 = performance.now();
    const res = await state.pool.runSingleSweep({
      sweepIndex: 0,
      k: state.normalizer.kSat,
      meta,
      dstSize,
      confThreshold: state.singleConf
    });
    const total = Math.round(performance.now() - t0);

    state.boxes = res.boxes;
    renderDisplay();
    updateDetectPill();

    els.bannerSpinner.classList.remove('is-active');
    els.bannerTitle.textContent = `Одиночный скан завершен · Найдено боксов: ${res.boxes.length}`;
    els.bannerSub.textContent = `Время расчета на ядре: ${res.inferMs} ms · Всего: ${total} ms`;
    els.bannerMetric.textContent = `${total} ms`;
  } catch (err) {
    console.error('Ошибка одиночного скана:', err);
    els.bannerTitle.textContent = 'Ошибка одиночного скана';
    els.bannerSub.textContent = err.message || String(err);
  } finally {
    state.isScanning = false;
  }
});

els.btnRunExtended.addEventListener('click', () => runParallelScan());

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
  if (els.btnRunExtended) {
    els.btnRunExtended.textContent = `▷ Запустить профилированный анализ (${state.extSteps} спектров)`;
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

// -----------------------------------------------------------------------------
// Главная точка входа
// -----------------------------------------------------------------------------
async function init() {
  setupCoresGrid();
  drawLiveChart();
  buildCarousel();
  syncPresetInputs();
  updateRunButtonText();

  try {
    els.hardwareStatus.textContent = `Запуск пула ${state.workerCount} воркеров...`;
    els.statusDot.classList.add('status-dot--loading');

    state.pool = new ParallelWorkerPool(state.workerCount, '/models/best.onnx');
    await state.pool.init((ready, total) => {
      els.hardwareStatus.textContent = `Воркеры: ${ready}/${total}...`;
    });

    els.hardwareStatus.textContent = `WASM Пул (${state.workerCount} ядер)`;
    els.statusDot.classList.remove('status-dot--loading');
    els.bannerTitle.textContent = `Пул готов · ${state.workerCount} ядер активно`;
    els.bannerSub.textContent = 'Выберите снимок и запустите параллельный анализ';

    if (SAMPLES.length > 0) {
      await loadSample(SAMPLES[0]);
      // Автозапуск первого снимка
      runParallelScan();
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
