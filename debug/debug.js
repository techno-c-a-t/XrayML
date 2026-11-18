import { XrayNormalizer } from '../xray-normalizer.js?v=4';
import { YoloDetector } from '../yolo-detector.js?v=4';

const SAMPLES = [
  { id: 'image2', name: 'Снимок 2 (Оружие)', path: '../samples/image2.jpg' },
  { id: 'image9', name: 'Снимок 9 (Оружие)', path: '../samples/image9.png' },
  { id: 'image10', name: 'Снимок 10 (Оружие)', path: '../samples/image10.png' },
  { id: 'image1', name: 'Снимок 1', path: '../samples/image1.jpg' },
  { id: 'image3', name: 'Снимок 3', path: '../samples/image3.png' }
];

const state = {
  normalizer: new XrayNormalizer(),
  detector: new YoloDetector({ modelPath: '../models/best.onnx' }),
  currentImage: null,
  currentImageId: null,
  activeView: 'detected',
  boxes: [],
  selectedThreads: Math.min(8, navigator.hardwareConcurrency || 4),
  lastTraceData: null
};

const els = {
  hardwareStatus: document.getElementById('hardwareStatus'),
  statusDot: document.getElementById('statusDot'),
  themeBtn: document.getElementById('themeBtn'),
  themeIcon: document.getElementById('themeIcon'),
  samplesCarousel: document.getElementById('samplesCarousel'),
  btnRunExtended: document.getElementById('btnRunExtended'),
  btnRunSingle: document.getElementById('btnRunSingle'),
  btnCopyTrace: document.getElementById('btnCopyTrace'),
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  displayCanvas: document.getElementById('displayCanvas'),
  normalizedCanvas: document.getElementById('normalizedCanvas'),
  originalCanvas: document.getElementById('originalCanvas'),
  // Debug fields
  dbgCores: document.getElementById('dbgCores'),
  dbgCoresSub: document.getElementById('dbgCoresSub'),
  dbgCOOP: document.getElementById('dbgCOOP'),
  dbgCOOPIcon: document.getElementById('dbgCOOPIcon'),
  dbgThreads: document.getElementById('dbgThreads'),
  dbgSimd: document.getElementById('dbgSimd'),
  dbgMemory: document.getElementById('dbgMemory'),
  dbgMemDetail: document.getElementById('dbgMemDetail'),
  dbgTotalTime: document.getElementById('dbgTotalTime'),
  timelineBar: document.getElementById('timelineBar'),
  breakdownTbody: document.getElementById('breakdownTbody'),
  sweepsTbody: document.getElementById('sweepsTbody')
};

// -----------------------------------------------------------------------------
// Инициализация аппаратного окружения
// -----------------------------------------------------------------------------
function inspectHardware() {
  const cores = navigator.hardwareConcurrency || 'N/A';
  els.dbgCores.textContent = `${cores} ядер`;
  els.dbgCoresSub.textContent = navigator.userAgent.includes('Android') ? 'Android ARM (big.LITTLE)' : 'Desktop x86 / ARM';

  const isCoop = window.crossOriginIsolated === true;
  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  els.dbgCOOP.textContent = isCoop ? 'Активна (COOP/COEP)' : 'ОТКЛЮЧЕНА (1 поток)';
  els.dbgCOOP.style.color = isCoop ? 'var(--threat-safe)' : '#ef4444';
  els.dbgCOOPIcon.textContent = hasSab ? 'SharedArrayBuffer доступен' : 'SharedArrayBuffer заблокирован браузером';

  els.dbgThreads.textContent = `${state.selectedThreads} потоков`;
  const isSimd = window.ort?.env?.wasm?.simd !== false;
  els.dbgSimd.textContent = `SIMD: ${isSimd ? 'Включен (SIMD128)' : 'Выключен'}`;

  if (performance.memory) {
    const usedMb = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
    const totalMb = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(1);
    els.dbgMemory.textContent = `${usedMb} MB`;
    els.dbgMemDetail.textContent = `Выделено всего: ${totalMb} MB`;
  } else {
    els.dbgMemory.textContent = 'N/A';
    els.dbgMemDetail.textContent = 'performance.memory недоступен в этом браузере';
  }
}

// -----------------------------------------------------------------------------
// Переключение ядер
// -----------------------------------------------------------------------------
document.querySelectorAll('.btn-thread').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.btn-thread').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const threads = parseInt(btn.dataset.threads, 10);
    state.selectedThreads = threads;
    els.hardwareStatus.textContent = `Перезапуск (${threads} потоков)...`;
    els.statusDot.classList.add('status-dot--loading');
    
    if (window.ort?.env?.wasm) {
      window.ort.env.wasm.numThreads = threads;
    }
    await state.detector.loadModel((p) => {
      if (p.status === 'ready') {
        els.hardwareStatus.textContent = `WASM SIMD (${threads} potok)`;
        els.statusDot.classList.remove('status-dot--loading');
      }
    });
    inspectHardware();
    if (state.currentImage) {
      runProfiledExtendedScan();
    }
  });
});

// -----------------------------------------------------------------------------
// Загрузка модели и сэмплов
// -----------------------------------------------------------------------------
async function init() {
  inspectHardware();
  buildCarousel();

  try {
    els.hardwareStatus.textContent = 'Загрузка весов ONNX...';
    await state.detector.loadModel((p) => {
      if (p.status === 'ready') {
        els.hardwareStatus.textContent = `WASM SIMD (${state.selectedThreads} thr)`;
        els.statusDot.classList.remove('status-dot--loading');
      }
    });

    if (SAMPLES.length > 0) {
      await loadSample(SAMPLES[0]);
      runProfiledExtendedScan();
    }
  } catch (err) {
    console.error('Ошибка инициализации:', err);
    els.hardwareStatus.textContent = 'Ошибка ONNX';
    els.statusDot.style.background = '#ef4444';
  }
}

function buildCarousel() {
  els.samplesCarousel.innerHTML = '';
  SAMPLES.forEach((sample, idx) => {
    const btn = document.createElement('div');
    btn.className = `sample-thumb ${sample.id === state.currentImageId ? 'is-active' : ''}`;
    btn.dataset.id = sample.id;
    btn.innerHTML = `
      <img src="${sample.path}" alt="${sample.name}">
      <span class="sample-tag">#${idx + 1}</span>
    `;
    btn.addEventListener('click', () => {
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
  els.originalCanvas.width = w;
  els.originalCanvas.height = h;
  els.originalCanvas.getContext('2d').drawImage(img, 0, 0);

  els.normalizedCanvas.width = w;
  els.normalizedCanvas.height = h;
  els.normalizedCanvas.getContext('2d').drawImage(img, 0, 0);

  renderDisplay();
}

// -----------------------------------------------------------------------------
// ГЛУБОКИЙ ПРОФИЛИРОВАННЫЙ АНАЛИЗ (30 СРЕЗОВ С ПОШАГОВОЙ ТРАССИРОВКОЙ)
// -----------------------------------------------------------------------------
async function runProfiledExtendedScan() {
  if (!state.currentImage || !state.detector.session) return;

  const img = state.currentImage;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  els.progressBarContainer.classList.remove('is-hidden');
  els.btnRunExtended.disabled = true;

  const trace = {
    startedAt: new Date().toISOString(),
    image: { width: w, height: h, id: state.currentImageId },
    hardware: {
      cores: navigator.hardwareConcurrency,
      threads: state.selectedThreads,
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      userAgent: navigator.userAgent
    },
    timings: {
      basePrepMs: 0,
      letterboxScaleMs: 0,
      saturationMathMs: 0,
      tensorAllocMs: 0,
      onnxRunMs: 0,
      getDataMs: 0,
      nmsMs: 0,
      wbfMs: 0,
      finalRenderMs: 0,
      totalWallMs: 0
    },
    sweeps: []
  };

  const tStartWall = performance.now();

  try {
    // 1. Базовая физическая нормализация кадра
    const t0 = performance.now();
    const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
    trace.timings.basePrepMs = Math.round(performance.now() - t0);

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
    const workSweepImgData = new ImageData(new Uint8ClampedArray(baseSweepImgData.data), dstSize, dstSize);
    trace.timings.letterboxScaleMs = Math.round(performance.now() - t1);

    const numSteps = 30;
    const stepSize = 0.95 / (numSteps - 1);
    const allBoxes = [];
    const area = dstSize * dstSize;
    const floatArr = new Float32Array(3 * area);
    const inv255 = 1.0 / 255.0;

    for (let i = 0; i < numSteps; i++) {
      const k = parseFloat((i * stepSize).toFixed(3));
      const sweepInfo = { step: i + 1, k, satMs: 0, tensorMs: 0, inferMs: 0, getDataMs: 0, nmsMs: 0, totalMs: 0, boxesFound: 0 };
      const tSweepStart = performance.now();

      // Десатурация
      const tSat0 = performance.now();
      state.normalizer.applySaturationOnly(baseSweepImgData, k, workSweepImgData);
      sweepInfo.satMs = +(performance.now() - tSat0).toFixed(2);
      trace.timings.saturationMathMs += sweepInfo.satMs;

      // Формирование тензора Float32
      const tTen0 = performance.now();
      const px = workSweepImgData.data;
      for (let p = 0; p < area; p++) {
        const pIdx = p * 4;
        floatArr[p] = px[pIdx] * inv255;
        floatArr[area + p] = px[pIdx + 1] * inv255;
        floatArr[area * 2 + p] = px[pIdx + 2] * inv255;
      }
      const tensor = new window.ort.Tensor('float32', floatArr, [1, 3, dstSize, dstSize]);
      sweepInfo.tensorMs = +(performance.now() - tTen0).toFixed(2);
      trace.timings.tensorAllocMs += sweepInfo.tensorMs;

      // Инференс ONNX
      const tInfer0 = performance.now();
      const feeds = {};
      feeds[state.detector.session.inputNames[0]] = tensor;
      const results = await state.detector.session.run(feeds);
      sweepInfo.inferMs = +(performance.now() - tInfer0).toFixed(2);
      trace.timings.onnxRunMs += sweepInfo.inferMs;

      // Чтение буфера
      const tData0 = performance.now();
      const outputTensor = results[state.detector.session.outputNames[0]];
      const data = typeof outputTensor.getData === 'function' ? await outputTensor.getData() : outputTensor.data;
      sweepInfo.getDataMs = +(performance.now() - tData0).toFixed(2);
      trace.timings.getDataMs += sweepInfo.getDataMs;

      // Декодирование боксов и NMS
      const tNms0 = performance.now();
      const [batch, channels, numBoxes] = outputTensor.dims;
      const rawBoxes = [];
      for (let b = 0; b < numBoxes; b++) {
        const conf = data[4 * numBoxes + b];
        if (conf >= 0.20) {
          const cx = data[0 * numBoxes + b];
          const cy = data[1 * numBoxes + b];
          const bw = data[2 * numBoxes + b];
          const bh = data[3 * numBoxes + b];
          const x1 = Math.max(0, (cx - bw / 2 - meta.padX) / meta.scale);
          const y1 = Math.max(0, (cy - bh / 2 - meta.padY) / meta.scale);
          const x2 = Math.min(meta.srcW, (cx + bw / 2 - meta.padX) / meta.scale);
          const y2 = Math.min(meta.srcH, (cy + bh / 2 - meta.padY) / meta.scale);
          rawBoxes.push({ x1, y1, x2, y2, width: x2 - x1, height: y2 - y1, conf, classId: 0, label: 'Gun', kSat: k });
        }
      }
      const stepBoxes = state.detector.applyNMS(rawBoxes, 0.45);
      sweepInfo.nmsMs = +(performance.now() - tNms0).toFixed(2);
      trace.timings.nmsMs += sweepInfo.nmsMs;

      sweepInfo.boxesFound = stepBoxes.length;
      sweepInfo.totalMs = +(performance.now() - tSweepStart).toFixed(2);
      trace.sweeps.push(sweepInfo);

      stepBoxes.forEach(b => allBoxes.push(b));

      // Прогресс
      const pct = Math.round(((i + 1) / numSteps) * 100);
      const elapsed = performance.now() - tStartWall;
      const avg = elapsed / (i + 1);
      const eta = Math.max(0, Math.round(((numSteps - i - 1) * avg) / 1000));
      els.progressPercent.textContent = `${pct}%`;
      els.progressFill.style.width = `${pct}%`;
      els.progressLabel.textContent = `Срез ${i + 1}/${numSteps} · ETA: ~${eta} сек`;

      await new Promise(r => setTimeout(r, 0));
    }

    // WBF слияние
    const tWbf0 = performance.now();
    const fusedBoxes = state.detector.mergeMultiSpectralBoxes(allBoxes, 0.45, 2);
    trace.timings.wbfMs = +(performance.now() - tWbf0).toFixed(2);

    // Финальная отрисовка
    const tRen0 = performance.now();
    state.boxes = fusedBoxes;
    renderDisplay();
    trace.timings.finalRenderMs = +(performance.now() - tRen0).toFixed(2);

    trace.timings.totalWallMs = Math.round(performance.now() - tStartWall);
    state.lastTraceData = trace;

    renderDiagnostics(trace);
  } finally {
    els.progressBarContainer.classList.add('is-hidden');
    els.btnRunExtended.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Отрисовка результатов диагностики
// -----------------------------------------------------------------------------
function renderDiagnostics(trace) {
  const total = trace.timings.totalWallMs;
  els.dbgTotalTime.textContent = `Всего: ${total} ms (~${(total / 1000).toFixed(2)} с)`;

  const items = [
    { name: 'Нейросеть ONNX (session.run)', time: trace.timings.onnxRunMs, color: '#00ADB5', desc: 'Умножение матриц на ядрах CPU через WASM SIMD' },
    { name: 'Чтение тензоров (getData)', time: trace.timings.getDataMs, color: '#3B82F6', desc: 'Передача Float32 памяти из WASM в JS' },
    { name: 'Формирование Float32 тензора', time: trace.timings.tensorAllocMs, color: '#F59E0B', desc: 'Разложение RGB каналов в NCHW [1,3,640,640]' },
    { name: 'Спектральная десатурация (JS)', time: trace.timings.saturationMathMs, color: '#10B981', desc: 'Математика десатурации 30 срезов на 640x640' },
    { name: 'NMS и декодирование боксов', time: trace.timings.nmsMs, color: '#8B5CF6', desc: 'Фильтрация пересечений и порогов уверенности' },
    { name: 'Ансамблирование WBF', time: trace.timings.wbfMs, color: '#EC4899', desc: 'Взвешенное слияние 30 срезов в финальные боксы' },
    { name: 'Базовая нормализация и скейл', time: trace.timings.basePrepMs + trace.timings.letterboxScaleMs, color: '#6B7280', desc: 'Полярность Оцу, нейтрализация фона, точка белого' },
    { name: 'Отрисовка Canvas / UI', time: trace.timings.finalRenderMs, color: '#9CA3AF', desc: 'Отрисовка полигонов и рамок угроз' }
  ];

  // Таймлайн бар
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

  // Таблица распределения
  els.breakdownTbody.innerHTML = '';
  items.forEach(it => {
    const pct = total > 0 ? ((it.time / total) * 100).toFixed(1) : 0;
    const avgSweep = (it.time / trace.sweeps.length).toFixed(1);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="time-dot" style="background:${it.color}"></span><strong>${it.name}</strong></td>
      <td>${Math.round(it.time)} ms</td>
      <td><strong>${pct}%</strong></td>
      <td>${avgSweep} ms</td>
      <td style="color:var(--text-muted); font-size:0.75rem;">${it.desc}</td>
    `;
    els.breakdownTbody.appendChild(tr);
  });

  // Таблица по срезам
  els.sweepsTbody.innerHTML = '';
  trace.sweeps.forEach(sw => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${sw.step}</td>
      <td>${sw.k.toFixed(2)}</td>
      <td>${sw.satMs} ms</td>
      <td>${sw.tensorMs} ms</td>
      <td style="color:var(--accent); font-weight:600;">${sw.inferMs} ms</td>
      <td>${sw.getDataMs} ms</td>
      <td>${sw.nmsMs} ms (${sw.boxesFound} b)</td>
      <td><strong>${sw.totalMs} ms</strong></td>
    `;
    els.sweepsTbody.appendChild(tr);
  });

  inspectHardware();
}

// -----------------------------------------------------------------------------
// Отрисовка холста
// -----------------------------------------------------------------------------
function renderDisplay() {
  const canvas = els.displayCanvas;
  const ctx = canvas.getContext('2d');
  const src = state.activeView === 'original' ? els.originalCanvas : els.normalizedCanvas;

  canvas.width = src.width;
  canvas.height = src.height;
  ctx.drawImage(src, 0, 0);

  if (state.activeView === 'detected' && state.boxes && state.boxes.length > 0) {
    state.boxes.forEach(box => {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x1, box.y1, box.width, box.height);

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      const label = `${box.label} ${(box.conf * 100).toFixed(0)}%`;
      const pad = 4;
      const textW = ctx.measureText(label).width;
      ctx.fillRect(box.x1, Math.max(0, box.y1 - 22), textW + pad * 2, 22);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, box.x1 + pad, Math.max(16, box.y1 - 6));
    });
  }
}

// Переключение табов вида
document.querySelectorAll('.view-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('is-active'));
    t.classList.add('is-active');
    state.activeView = t.dataset.view;
    renderDisplay();
  });
});

// Кнопка копирования трассировки
els.btnCopyTrace.addEventListener('click', () => {
  if (!state.lastTraceData) {
    alert('Сначала запустите анализ!');
    return;
  }
  const text = JSON.stringify(state.lastTraceData, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    alert('Полный JSON-лог трассировки скопирован в буфер обмена!');
  }).catch(() => {
    prompt('Скопируйте лог вручную:', text);
  });
});

// Кнопки запуска
els.btnRunExtended.addEventListener('click', () => runProfiledExtendedScan());

// Инициализация
init();
