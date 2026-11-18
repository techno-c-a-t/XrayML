import { XrayNormalizer } from './xray-normalizer.js?v=8';
import { YoloDetector } from './yolo-detector.js?v=8';

// Список встроенных сэмплов из папки samples/
const BUILTIN_SAMPLES = [
  { id: 'image2', name: 'Снимок 2 (Оружие)', path: 'samples/image2.jpg', isCustom: false },
  { id: 'image3', name: 'Снимок 3', path: 'samples/image3.png', isCustom: false },
  { id: 'image17', name: 'Снимок 17', path: 'samples/image17.png', isCustom: false },
  { id: 'image9', name: 'Снимок 9 (Оружие)', path: 'samples/image9.png', isCustom: false },
  { id: 'image1', name: 'Снимок 1', path: 'samples/image1.jpg', isCustom: false },
  { id: 'image4', name: 'Снимок 4', path: 'samples/image4.png', isCustom: false },
  { id: 'image10', name: 'Снимок 10 (Оружие)', path: 'samples/image10.png', isCustom: false }
];

// -----------------------------------------------------------------------------
// Мультиязычность (i18n): RU, BE, EN
// -----------------------------------------------------------------------------
const i18n = {
  ru: {
    docTitle: "X-Ray Threat Scanner | On-Device Edge AI",
    brandTitle: "X-Ray Threat Scanner",
    dropzoneAction: "Нажмите для выбора снимка",
    dropzoneOr: "или перетащите файл",
    dropzoneHint: "PNG, JPG, WebP любого разрешения · 100% On-Device",
    galleryTitle: "Лента снимков:",
    btnClearCustom: "Очистить добавленные",
    samplesCounter: "снимков",
    btnRunStandard: "Сканировать фото (Одиночный)",
    btnRunExtended: "▷ Extended Мульти-сканирование",
    settingsSingleTitle: "Параметры одиночного режима (White Balance & k_sat)",
    confThresholdLabel: "Порог уверенности (Confidence)",
    satLabel: "Десатурация (k_sat)",
    whitePointLabel: "Точка белого (Target White)",
    normToggleLabel: "Включить физическую нормализацию (полярность, фон, десатурация)",
    extTitle: "Параметры мульти-спектрального сканирования",
    extPresetLabel: "Пресет мульти-сканирования",
    presetDeep: "🔬 Глубокий анализ (Порог 20%, 30 шагов, 2 кадра)",
    presetParanoid: "🚨 Параноидальный (Порог 15%, 20 шагов, 1 кадр)",
    presetBalanced: "⚖️ Сбалансированный (Порог 25%, 20 шагов, 2 кадра)",
    presetCustom: "⚙️ Пользовательский",
    extConfLabel: "Порог уверенности спектров",
    extStepsLabel: "Количество спектров (Шаг)",
    extIouLabel: "Фильтр слияния (IoU / WBF)",
    extMinHitsLabel: "Мин. подтверждений",
    tabDetected: "С детекцией",
    tabNormalized: "Нормализованный",
    tabOriginal: "Исходный скан",
    threatWaiting: "Ожидание снимка",
    threatNone: "Угроз не обнаружено",
    threatDetected: "УГРОЗА ОБНАРУЖЕНА",
    metricThreats: "Детекции угроз",
    metricPolarity: "Полярность кадра",
    metricInferTime: "Время инференса",
    metricResolution: "Размер снимка",
    authorTag: "Создатель",
    authorTitle: "Об авторе проекта",
    authorName: "Nikitos (@techno_c_a_t)",
    authorBio: "Студент ПМИ, разработчик решений на C++, Python, Linux, Embedded и On-Device Edge AI. Автор проектов NSLDAI (Phantom), SwipeBeat и X-Ray Threat Scanner.",
    authorBtnPortfolio: "Портфолио technocat.cc",
    authorBtnTelegram: "Telegram",
    authorBtnGithub: "GitHub",
    footerText: "Архитектура YOLO11 nano · 100% On-Device WebGPU/WASM · Снимки не отправляются на сервер",
    positivePolarity: "Позитив (Светлый фон)",
    negativePolarity: "Негатив (Инвертирован)",
    polarityAuto: "Автоопределение",
    inputFrame: "Входной кадр",
    loaderLoading: "Загрузка снимка...",
    loaderInference: "Обработка снимка нейросетью...",
    workerSweeps: "Сканирование спектров...",
    weaponDetected: "Оружие (Пистолет)"
  },
  be: {
    docTitle: "X-Ray Threat Scanner | On-Device Edge AI",
    brandTitle: "X-Ray Threat Scanner",
    dropzoneAction: "Націсніце для выбару здымка",
    dropzoneOr: "ці перацягніце файл",
    dropzoneHint: "PNG, JPG, WebP любога разрознення · 100% On-Device",
    galleryTitle: "Стужка здымкаў:",
    btnClearCustom: "Ачысціць дададзеныя",
    samplesCounter: "здымкаў",
    btnRunStandard: "Сканаваць фота (Адзіночны)",
    btnRunExtended: "▷ Extended Мульці-сканаванне",
    settingsSingleTitle: "Параметры адзіночнага рэжыму (White Balance & k_sat)",
    confThresholdLabel: "Парог упэўненасці (Confidence)",
    satLabel: "Дэсатурацыя (k_sat)",
    whitePointLabel: "Пункт белага (Target White)",
    normToggleLabel: "Уключыць фізічную нармалізацыю (палярнасць, фон, дэсатурацыя)",
    extTitle: "Параметры мульці-спектральнага сканавання",
    extPresetLabel: "Прэсет мульці-сканавання",
    presetDeep: "🔬 Глыбокі аналіз (Парог 20%, 30 крокаў, 2 кадры)",
    presetParanoid: "🚨 Паранаідальны (Парог 15%, 20 крокаў, 1 кадр)",
    presetBalanced: "⚖️ Збалансаваны (Парог 25%, 20 крокаў, 2 кадры)",
    presetCustom: "⚙️ Карыстальніцкі",
    extConfLabel: "Парог упэўненасці спектраў",
    extStepsLabel: "Колькасць спектраў (Крок)",
    extIouLabel: "Фільтр зліцця (IoU / WBF)",
    extMinHitsLabel: "Мін. пацверджанняў",
    tabDetected: "З дэтэкцыяй",
    tabNormalized: "Нармалізаваны",
    tabOriginal: "Зыходны скан",
    threatWaiting: "Чаканне здымка",
    threatNone: "Пагроз не выяўлена",
    threatDetected: "ПАГРОЗА ВЫЯЎЛЕНА",
    metricThreats: "Дэтэкцыі пагроз",
    metricPolarity: "Палярнасць кадра",
    metricInferTime: "Час інферэнсу",
    metricResolution: "Памер здымка",
    authorTag: "Стваральнік",
    authorTitle: "Пра аўтара праекта",
    authorName: "Nikitos (@techno_c_a_t)",
    authorBio: "Студэнт ПМІ, распрацоўшчык рашэнняў на C++, Python, Linux, Embedded і On-Device Edge AI. Аўтар праектаў NSLDAI (Phantom), SwipeBeat і X-Ray Threat Scanner.",
    authorBtnPortfolio: "Партфоліа technocat.cc",
    authorBtnTelegram: "Telegram",
    authorBtnGithub: "GitHub",
    footerText: "Архітэктура YOLO11 nano · 100% On-Device WebGPU/WASM · Здымкі не адпраўляюцца на сервер",
    positivePolarity: "Пазітыў (Светлы фон)",
    negativePolarity: "Негатыў (Інвертаваны)",
    polarityAuto: "Аўтавызначэнне",
    inputFrame: "Уваходны кадр",
    loaderLoading: "Загрузка здымка...",
    loaderInference: "Апрацоўка здымка нейрасеткай...",
    workerSweeps: "Сканаванне спектраў...",
    weaponDetected: "Зброя (Пісталет)"
  },
  en: {
    docTitle: "X-Ray Threat Scanner | On-Device Edge AI",
    brandTitle: "X-Ray Threat Scanner",
    dropzoneAction: "Click to select a scan",
    dropzoneOr: "or drag and drop a file",
    dropzoneHint: "PNG, JPG, WebP any resolution · 100% On-Device",
    galleryTitle: "Scan Feed:",
    btnClearCustom: "Clear Uploaded",
    samplesCounter: "images",
    btnRunStandard: "Scan Photo (Single)",
    btnRunExtended: "▷ Extended Multi-Scan",
    settingsSingleTitle: "Single Mode Parameters (White Balance & k_sat)",
    confThresholdLabel: "Confidence Threshold",
    satLabel: "Desaturation (k_sat)",
    whitePointLabel: "Target White Point",
    normToggleLabel: "Enable physical normalization (polarity, background, desaturation)",
    extTitle: "Multi-Spectral Scan Parameters",
    extPresetLabel: "Multi-Scan Preset",
    presetDeep: "🔬 Deep Analysis (Threshold 20%, 30 steps, 2 hits)",
    presetParanoid: "🚨 Paranoid (Threshold 15%, 20 steps, 1 hit)",
    presetBalanced: "⚖️ Balanced (Threshold 25%, 20 steps, 2 hits)",
    presetCustom: "⚙️ Custom",
    extConfLabel: "Spectral Confidence Threshold",
    extStepsLabel: "Number of Spectra (Steps)",
    extIouLabel: "Fusion Filter (IoU / WBF)",
    extMinHitsLabel: "Min Hits Threshold",
    tabDetected: "Detections",
    tabNormalized: "Normalized",
    tabOriginal: "Original Scan",
    threatWaiting: "Waiting for scan",
    threatNone: "No threats detected",
    threatDetected: "THREAT DETECTED",
    metricThreats: "Threat Detections",
    metricPolarity: "Frame Polarity",
    metricInferTime: "Inference Latency",
    metricResolution: "Image Resolution",
    authorTag: "Creator",
    authorTitle: "About the Author",
    authorName: "Nikitos (@techno_c_a_t)",
    authorBio: "Applied Math & CS student, developer specializing in C++, Python, Linux, Embedded, and On-Device Edge AI. Creator of NSLDAI (Phantom), SwipeBeat, and X-Ray Threat Scanner.",
    authorBtnPortfolio: "Portfolio technocat.cc",
    authorBtnTelegram: "Telegram",
    authorBtnGithub: "GitHub",
    footerText: "YOLO11 nano architecture · 100% On-Device WebGPU/WASM · Scans never leave your device",
    positivePolarity: "Positive (Light BG)",
    negativePolarity: "Negative (Inverted)",
    polarityAuto: "Auto-detection",
    inputFrame: "Input Frame",
    loaderLoading: "Loading image...",
    loaderInference: "Neural network inference...",
    workerSweeps: "Scanning spectra...",
    weaponDetected: "Firearm (Gun)"
  }
};

// Алгоритм автоопределения языка в стиле technocat.cc / phantom.technocat.cc
function detectLanguage() {
  const saved = localStorage.getItem('xray_lang');
  if (saved && i18n[saved]) return saved;

  const browserLangs = navigator.languages || [navigator.language || navigator.userLanguage];
  const isBelarusian = browserLangs.some(l => (l || '').toLowerCase().includes('be') || (l || '').toLowerCase().includes('by'))
    || (Intl.DateTimeFormat().resolvedOptions().timeZone || '').includes('Minsk');
  if (isBelarusian) return 'be';

  const isRussian = browserLangs.some(l => (l || '').toLowerCase().includes('ru'));
  if (isRussian) return 'ru';

  return 'en';
}

let currentLang = detectLanguage();

// Темы оформления: dark, light, cyber
const THEMES = ['dark', 'light', 'cyber'];
const THEME_ICONS = { dark: '🌙', light: '☀️', cyber: '⚡' };

function detectTheme() {
  const saved = localStorage.getItem('xray_theme');
  if (saved && THEMES.includes(saved)) return saved;
  return 'dark';
}

let currentTheme = detectTheme();

// -----------------------------------------------------------------------------
// Расчет количества ядер CPU и воркеров пула
// -----------------------------------------------------------------------------
const HARDWARE_CORES = navigator.hardwareConcurrency || 4;
const WORKER_COUNT = HARDWARE_CORES <= 4 ? Math.max(1, HARDWARE_CORES - 1) : HARDWARE_CORES - 2;

// Состояние приложения
const state = {
  samples: [...BUILTIN_SAMPLES],
  currentImageId: null,
  currentImage: null,
  scanResults: {}, // Кэш результатов сканирования: { [id]: { boxes, metrics, polarityInfo } }
  activeTab: 'detected', // 'detected' | 'normalized' | 'original'
  boxes: [],
  polarityInfo: null,
  metrics: null,
  isProcessing: false,
  extPreset: 'deep', // По умолчанию ГЛУБОКИЙ АНАЛИЗ
  extSteps: 30,      // 30 шагов
  extIou: 0.45,
  extConf: 0.20,     // Порог 20%
  extMinHits: 2,     // 2 кадра подтверждения
  hardwareCores: HARDWARE_CORES,
  workerCount: WORKER_COUNT,
  pool: null,
  normalizer: new XrayNormalizer({ kSat: 0.42, targetWhite: 248 }),
  detector: new YoloDetector({ modelPath: 'models/best.onnx', confThreshold: 0.35 })
};
window.state = state;

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
        const w = new Worker('./inference-worker.js?v=8');
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

  async runParallelSweeps(tasks, onSweepDone) {
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
            if (data.type === 'sweep_done') {
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

// Элементы DOM
const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  samplesCarousel: document.getElementById('samplesCarousel'),
  samplesCounter: document.getElementById('samplesCounter'),
  btnClearCustom: document.getElementById('btnClearCustom'),
  hardwarePill: document.getElementById('hardwarePill'),
  statusDot: document.getElementById('statusDot'),
  hardwareStatus: document.getElementById('hardwareStatus'),
  workerPill: document.getElementById('workerPill'),
  workerStatusText: document.getElementById('workerStatusText'),
  originalCanvas: document.getElementById('originalCanvas'),
  normalizedCanvas: document.getElementById('normalizedCanvas'),
  displayCanvas: document.getElementById('displayCanvas'),
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  loaderOverlay: document.getElementById('loaderOverlay'),
  loaderMessage: document.getElementById('loaderMessage'),
  threatBadge: document.getElementById('threatBadge'),
  threatText: document.getElementById('threatText'),
  threatCount: document.getElementById('threatCount'),
  threatDetail: document.getElementById('threatDetail'),
  polarityStatus: document.getElementById('polarityStatus'),
  polarityDetail: document.getElementById('polarityDetail'),
  inferTime: document.getElementById('inferTime'),
  inferBackend: document.getElementById('inferBackend'),
  imageResolution: document.getElementById('imageResolution'),
  confRange: document.getElementById('confRange'),
  confVal: document.getElementById('confVal'),
  satRange: document.getElementById('satRange'),
  satVal: document.getElementById('satVal'),
  whiteRange: document.getElementById('whiteRange'),
  whiteVal: document.getElementById('whiteVal'),
  normalizeToggle: document.getElementById('normalizeToggle'),
  btnRunStandard: document.getElementById('btnRunStandard'),
  btnRunExtended: document.getElementById('btnRunExtended'),
  extPresetSelect: document.getElementById('extPresetSelect'),
  extConfRange: document.getElementById('extConfRange'),
  extConfVal: document.getElementById('extConfVal'),
  extStepRange: document.getElementById('extStepRange'),
  extStepVal: document.getElementById('extStepVal'),
  extIouRange: document.getElementById('extIouRange'),
  extIouVal: document.getElementById('extIouVal'),
  extMinHitsRange: document.getElementById('extMinHitsRange'),
  extMinHitsVal: document.getElementById('extMinHitsVal'),
  tabDetected: document.getElementById('tabDetected'),
  tabNormalized: document.getElementById('tabNormalized'),
  tabOriginal: document.getElementById('tabOriginal'),
  langBtn: document.getElementById('langBtn'),
  langMenu: document.getElementById('langMenu'),
  currentLangLabel: document.getElementById('currentLangLabel'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon')
};

// Применение языка
function setLanguage(lang) {
  if (!i18n[lang]) return;
  currentLang = lang;
  localStorage.setItem('xray_lang', lang);
  document.documentElement.lang = lang;
  document.body.setAttribute('data-lang', lang);

  const labels = { ru: '🇷🇺 RU', be: '🇧🇾 BE', en: '🇬🇧 EN' };
  if (els.currentLangLabel) {
    els.currentLangLabel.textContent = labels[lang] || 'RU';
  }

  // Обновляем все элементы с атрибутом data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[lang] && i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });

  // Обновляем счетчик сэмплов
  if (els.samplesCounter) {
    els.samplesCounter.textContent = `${state.samples.length} ${i18n[lang].samplesCounter}`;
  }

  // Обновляем текст статуса угрозы
  if (state.boxes && state.boxes.length > 0) {
    els.threatText.textContent = `${i18n[lang].threatDetected} (${state.boxes.length})`;
    els.threatDetail.textContent = `${i18n[lang].weaponDetected}: ${state.boxes.length}`;
  } else if (state.currentImage) {
    els.threatText.textContent = i18n[lang].threatNone;
    els.threatDetail.textContent = i18n[lang].threatNone;
  } else {
    els.threatText.textContent = i18n[lang].threatWaiting;
    els.threatDetail.textContent = i18n[lang].threatNone;
  }

  // Обновляем статус полярности
  if (state.polarityInfo) {
    els.polarityStatus.textContent = state.polarityInfo.isInverted ? i18n[lang].negativePolarity : i18n[lang].positivePolarity;
  }
}

// Применение темы
function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'dark';
  currentTheme = theme;
  localStorage.setItem('xray_theme', theme);
  document.body.setAttribute('data-theme', theme);
  if (els.themeIcon) {
    els.themeIcon.textContent = THEME_ICONS[theme] || '🌙';
  }
}

function cycleTheme() {
  const nextIdx = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  setTheme(THEMES[nextIdx]);
  if (state.boxes.length > 0) {
    renderDisplay();
  }
}

// Инициализация приложения
async function init() {
  setTheme(currentTheme);
  setLanguage(currentLang);
  buildCarousel();
  bindEvents();

  try {
    els.hardwareStatus.textContent = `Запуск пула (${state.workerCount} ядер)...`;
    els.statusDot.classList.add('status-dot--loading');

    state.pool = new ParallelWorkerPool(state.workerCount, 'models/best.onnx');
    await state.pool.init((ready, total) => {
      els.hardwareStatus.textContent = `Воркеры: ${ready}/${total}...`;
    });

    els.hardwareStatus.textContent = `WASM SIMD (${state.workerCount} ядер)`;
    els.statusDot.classList.remove('status-dot--loading');

    // По умолчанию при первой загрузке запускаем глубокое мульти-сканирование первого снимка
    if (state.samples.length > 0) {
      await loadSample(state.samples[0], false);
      console.log('Автозапуск глубокого параллельного мульти-сканирования при старте...');
      await processImage(state.currentImage, true);
    }
  } catch (err) {
    console.error('Ошибка инициализации пула воркеров:', err);
    els.hardwareStatus.textContent = 'Ошибка воркеров';
    els.statusDot.style.background = '#EF4444';
    els.statusDot.classList.remove('status-dot--loading');
  }
}

// Генерация карусели сэмплов
function buildCarousel() {
  els.samplesCarousel.innerHTML = '';
  if (els.samplesCounter) {
    els.samplesCounter.textContent = `${state.samples.length} ${i18n[currentLang].samplesCounter}`;
  }

  state.samples.forEach((sample, idx) => {
    const btn = document.createElement('div');
    const isActive = sample.id === state.currentImageId;
    btn.className = `sample-thumb ${isActive ? 'is-active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', sample.name);
    btn.dataset.id = sample.id;

    // Картинка превью
    const img = document.createElement('img');
    img.src = sample.path;
    img.alt = sample.name;
    img.loading = 'lazy';

    // Бейдж номера
    const tag = document.createElement('span');
    tag.className = 'sample-tag';
    tag.textContent = sample.isCustom ? `+${idx + 1}` : `#${idx + 1}`;

    // Индикатор статуса последнего сканирования
    const cached = state.scanResults[sample.id];
    if (cached) {
      const dot = document.createElement('span');
      dot.className = `sample-threat-dot ${cached.boxes.length > 0 ? 'sample-threat-dot--danger' : 'sample-threat-dot--safe'}`;
      dot.title = cached.boxes.length > 0 ? `Найдено угроз: ${cached.boxes.length}` : 'Угроз не обнаружено';
      btn.appendChild(dot);
    }

    // Кнопка удаления для пользовательских фото
    if (sample.isCustom) {
      const delBtn = document.createElement('button');
      delBtn.className = 'sample-btn-delete';
      delBtn.title = 'Удалить снимок из ленты';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSample(sample.id);
      });
      btn.appendChild(delBtn);
    }

    btn.appendChild(img);
    btn.appendChild(tag);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.sample-thumb').forEach(t => t.classList.remove('is-active'));
      btn.classList.add('is-active');
      loadSample(sample, false);
    });

    els.samplesCarousel.appendChild(btn);
  });
}

function deleteSample(id) {
  state.samples = state.samples.filter(s => s.id !== id);
  delete state.scanResults[id];
  buildCarousel();
  if (state.currentImageId === id && state.samples.length > 0) {
    loadSample(state.samples[0], false);
  }
}

// Загрузка выбранного образца (с восстановлением кэша последнего сканирования)
async function loadSample(sample, autoDetect = false) {
  state.currentImageId = sample.id;
  document.querySelectorAll('.sample-thumb').forEach(t => {
    t.classList.toggle('is-active', t.dataset.id === sample.id);
  });

  showLoader(`${i18n[currentLang].loaderLoading} ${sample.name}...`);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = sample.path;
    await img.decode();
    state.currentImage = img;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    els.originalCanvas.width = w;
    els.originalCanvas.height = h;
    const origCtx = els.originalCanvas.getContext('2d', { willReadFrequently: true });
    origCtx.drawImage(img, 0, 0);

    els.normalizedCanvas.width = w;
    els.normalizedCanvas.height = h;
    const normCtx = els.normalizedCanvas.getContext('2d', { willReadFrequently: true });
    normCtx.drawImage(img, 0, 0);

    // Восстанавливаем из кэша результаты предыдущего сканирования
    const cached = state.scanResults[sample.id];
    if (cached) {
      state.boxes = cached.boxes;
      state.metrics = cached.metrics;
      state.polarityInfo = cached.polarityInfo;
      if (els.normalizeToggle.checked) {
        state.normalizer.process(els.normalizedCanvas);
      }
      updateTelemetry(w, h);
    } else {
      state.boxes = [];
      state.metrics = null;
      state.polarityInfo = null;
      updateTelemetry(w, h);
    }

    renderDisplay();

    if (autoDetect && state.pool) {
      await processImage(img, false);
    }
  } catch (err) {
    console.error('Ошибка чтения изображения:', err);
  } finally {
    hideLoader();
  }
}

// Обработка загруженного изображения через пайплайн
async function processImage(img, forceExtended = false) {
  if (state.isProcessing) return;
  state.isProcessing = true;
  state.currentImage = img;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  // 1. Исходный холст
  els.originalCanvas.width = w;
  els.originalCanvas.height = h;
  const origCtx = els.originalCanvas.getContext('2d', { willReadFrequently: true });
  origCtx.drawImage(img, 0, 0);

  // 2. Нормализация
  els.normalizedCanvas.width = w;
  els.normalizedCanvas.height = h;
  const normCtx = els.normalizedCanvas.getContext('2d', { willReadFrequently: true });

  const shouldNormalize = els.normalizeToggle.checked;
  const isExtended = forceExtended;

  if (isExtended) {
    // EXTENDED SCAN MODE (Параллельный спектральный ансамбль)
    if (!state.pool) {
      alert('Пул воркеров еще не инициализирован');
      state.isProcessing = false;
      return;
    }

    console.log(`[Extended Scan] Старт параллельного анализа: шагов=${state.extSteps}, conf=${state.extConf}, minHits=${state.extMinHits}, iou=${state.extIou}`);
    setWorkerStatus(true, `Сканирование ${state.extSteps} спектров...`);
    setProgress(true, `Оценка времени сканирования...`, 0);

    try {
      const tStart = performance.now();
      normCtx.drawImage(img, 0, 0);

      // 1. Базовая физическая нормализация на полном разрешении кадра
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;

      // 2. Масштабирование до 640x640 для спектрального анализа
      const dstSize = state.detector.inputSize || 640;
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

      // 3. Синхронизируем базовый кадр в память воркеров (<10 мс)
      await state.pool.setBaseImage(baseSweepImgData.data);

      // 4. Формирование пула задач (30 срезов)
      const numSteps = state.extSteps;
      const stepSize = numSteps > 1 ? 0.95 / (numSteps - 1) : 0;
      const tasks = [];
      for (let i = 0; i < numSteps; i++) {
        const k = parseFloat((i * stepSize).toFixed(3));
        tasks.push({ sweepIndex: i, k, meta, dstSize, confThreshold: state.extConf });
      }

      // 5. Запуск параллельного инференса на выделенных ядрах
      let completedCount = 0;
      const allBoxes = await state.pool.runParallelSweeps(
        tasks,
        (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes) => {
          completedCount++;
          const pct = Math.round((completedCount / numSteps) * 100);

          let etaText = '';
          if (completedCount > 1) {
            const elapsed = performance.now() - tStart;
            const avg = elapsed / completedCount;
            const remSec = Math.max(0, Math.round(((numSteps - completedCount) * avg) / 1000));
            etaText = remSec > 0 ? ` (~${remSec} сек)` : ' (завершение...)';
          }

          const label = `${currentLang === 'be' ? 'Спектральны аналіз' : currentLang === 'en' ? 'Spectral analysis' : 'Спектральный анализ'}: ${completedCount}/${numSteps}${etaText}`;
          setProgress(true, label, pct);
          setWorkerStatus(true, `Срез ${completedCount}/${numSteps}${etaText}`);
        }
      );

      // 6. Слияние детекций спектров через WBF с точным подсчетом срезов (hits)
      const fusedBoxes = state.detector.mergeMultiSpectralBoxes(allBoxes, state.extIou, state.extMinHits, numSteps);

      // 7. Десатурация нормализованного холста для пользователя
      state.normalizer.process(els.normalizedCanvas);

      const tEnd = performance.now();
      const totalWallMs = Math.round(tEnd - tStart);

      state.boxes = fusedBoxes;
      state.metrics = {
        totalMs: totalWallMs,
        provider: `WASM SIMD (${state.workerCount} ядер) × ${numSteps} срезов`
      };

      if (state.currentImageId) {
        state.scanResults[state.currentImageId] = {
          boxes: state.boxes,
          metrics: state.metrics,
          polarityInfo: state.polarityInfo
        };
        buildCarousel();
      }

      updateTelemetry(w, h);
      renderDisplay();
    } catch (err) {
      console.error('Ошибка в Extended Scan:', err);
      alert('Ошибка при мульти-спектральном сканировании: ' + err.message);
    } finally {
      setProgress(false);
      setWorkerStatus(false);
      state.isProcessing = false;
    }
  } else {
    // SINGLE MODE (Одиночный скан на прогретом ядре #0 пула)
    if (!state.pool) {
      alert('Пул воркеров еще не инициализирован');
      state.isProcessing = false;
      return;
    }

    showLoader(i18n[currentLang].loaderInference);
    const t0 = performance.now();

    try {
      normCtx.drawImage(img, 0, 0);
      if (shouldNormalize) {
        const normRes = state.normalizer.process(els.normalizedCanvas);
        state.polarityInfo = normRes.polarity;
      } else {
        state.polarityInfo = null;
      }

      const inputCanvas = shouldNormalize ? els.normalizedCanvas : els.originalCanvas;
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
      sweepCtx.drawImage(inputCanvas, 0, 0, w, h, padX, padY, newW, newH);

      const baseData = sweepCtx.getImageData(0, 0, dstSize, dstSize);
      await state.pool.setBaseImage(baseData.data);

      const res = await state.pool.runSingleSweep({
        sweepIndex: 0,
        k: state.normalizer.kSat,
        meta,
        dstSize,
        confThreshold: state.detector.confThreshold
      });

      const totalWallMs = Math.round(performance.now() - t0);
      state.boxes = res.boxes;
      state.metrics = {
        totalMs: totalWallMs,
        provider: `WASM SIMD (${state.workerCount} ядер) · 1 срез`
      };

      if (state.currentImageId) {
        state.scanResults[state.currentImageId] = {
          boxes: state.boxes,
          metrics: state.metrics,
          polarityInfo: state.polarityInfo
        };
        buildCarousel();
      }

      updateTelemetry(w, h);
      renderDisplay();
    } catch (err) {
      console.error('Ошибка одиночного инференса:', err);
    } finally {
      hideLoader();
      state.isProcessing = false;
    }
  }
}

// Отрисовка на видимый интерактивный холст
function renderDisplay() {
  const display = els.displayCanvas;
  const ctx = display.getContext('2d');

  let sourceCanvas = els.originalCanvas;
  if (state.activeTab === 'normalized') {
    sourceCanvas = els.normalizedCanvas;
  } else if (state.activeTab === 'detected') {
    sourceCanvas = els.normalizeToggle.checked ? els.normalizedCanvas : els.originalCanvas;
  }

  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;

  display.width = sourceCanvas.width;
  display.height = sourceCanvas.height;
  ctx.drawImage(sourceCanvas, 0, 0);

  // Если выбран режим "С детекцией", рисуем рамки
  if (state.activeTab === 'detected' && state.boxes.length > 0) {
    drawBoundingBoxes(ctx, display.width, display.height);
  }
}

// Отрисовка рамок угроз
function drawBoundingBoxes(ctx, imgW, imgH) {
  state.boxes.forEach(box => {
    const x = box.x1;
    const y = box.y1;
    const w = box.width || (box.x2 - box.x1);
    const h = box.height || (box.y2 - box.y1);

    // Свечение и рамка в неоновом киберпанк-стиле
    ctx.save();
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(3, Math.round(imgW / 350));
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // Заливка полупрозрачным красным
    ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.fillRect(x, y, w, h);

    // Угловые метки
    const cornerSize = Math.max(8, Math.min(w, h) * 0.15);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, Math.round(imgW / 450));
    ctx.beginPath();
    ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y);
    ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize);
    ctx.moveTo(x, y + h - cornerSize); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerSize, y + h);
    ctx.moveTo(x + w - cornerSize, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerSize);
    ctx.stroke();

    // Лейбл оружия с точным числом подтвержденных спектров (hits)
    const confPct = box.conf != null ? (box.conf * 100).toFixed(1) : '—';
    const totalSweeps = box.totalSweeps || state.extSteps;
    const hitsText = box.detectionsCount ? ` · ${box.detectionsCount}/${totalSweeps} hits` : '';
    const labelText = `⚠ ${i18n[currentLang].weaponDetected} ${confPct}%${hitsText}`;

    const fontSize = Math.max(12, Math.round(imgW / 40));
    ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
    const textMetrics = ctx.measureText(labelText);
    const textW = textMetrics.width;
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

// Обновление телеметрии и индикаторов
function updateTelemetry(w, h) {
  const lang = currentLang;
  const numBoxes = state.boxes.length;
  els.threatCount.textContent = numBoxes;

  if (numBoxes > 0) {
    els.threatBadge.className = 'detection-status is-danger';
    els.threatText.textContent = `${i18n[lang].threatDetected} (${numBoxes})`;
    els.threatDetail.textContent = `${i18n[lang].weaponDetected}: ${numBoxes}`;
  } else if (state.currentImage) {
    els.threatBadge.className = 'detection-status is-safe';
    els.threatText.textContent = i18n[lang].threatNone;
    els.threatDetail.textContent = i18n[lang].threatNone;
  } else {
    els.threatBadge.className = 'detection-status';
    els.threatText.textContent = i18n[lang].threatWaiting;
    els.threatDetail.textContent = i18n[lang].threatNone;
  }

  if (state.polarityInfo) {
    els.polarityStatus.textContent = state.polarityInfo.isInverted ? i18n[lang].negativePolarity : i18n[lang].positivePolarity;
    const bg = state.polarityInfo.bgMean ?? state.polarityInfo.borderMean;
    const fg = state.polarityInfo.fgMean ?? state.polarityInfo.centerMean;
    if (bg != null && fg != null) {
      els.polarityDetail.textContent = `Bg: ${bg.toFixed(0)}, Fg: ${fg.toFixed(0)}`;
    } else {
      els.polarityDetail.textContent = state.polarityInfo.isInverted ? i18n[lang].negativePolarity : i18n[lang].positivePolarity;
    }
  } else {
    els.polarityStatus.textContent = '—';
    els.polarityDetail.textContent = i18n[lang].polarityAuto;
  }

  if (state.metrics) {
    els.inferTime.textContent = `${state.metrics.totalMs} ms`;
    els.inferBackend.textContent = state.metrics.provider || 'On-Device';
  } else {
    els.inferTime.textContent = '— ms';
    els.inferBackend.textContent = 'On-Device Edge';
  }

  if (w && h) {
    els.imageResolution.textContent = `${w} × ${h}`;
  } else {
    els.imageResolution.textContent = '— × —';
  }
}

function setProgress(show, label = '', percent = 0) {
  if (!els.progressBarContainer) return;
  if (show) {
    els.progressBarContainer.classList.remove('is-hidden');
    els.progressLabel.textContent = label;
    els.progressPercent.textContent = `${percent}%`;
    els.progressFill.style.width = `${percent}%`;
  } else {
    els.progressBarContainer.classList.add('is-hidden');
    els.progressFill.style.width = '0%';
  }
}

function setWorkerStatus(show, text = '') {
  if (!els.workerPill) return;
  if (show) {
    els.workerPill.classList.remove('is-hidden');
    els.workerStatusText.textContent = text;
  } else {
    els.workerPill.classList.add('is-hidden');
  }
}

function showLoader(msg) {
  els.loaderMessage.textContent = msg;
  els.loaderOverlay.classList.remove('is-hidden');
}

function hideLoader() {
  els.loaderOverlay.classList.add('is-hidden');
}

// Привязка обработчиков событий
function bindEvents() {
  // Dropzone drag & drop
  const dropzone = els.dropzone;
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  dropzone.addEventListener('click', () => els.fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  // Очистка добавленных снимков
  if (els.btnClearCustom) {
    els.btnClearCustom.addEventListener('click', () => {
      state.samples = state.samples.filter(s => !s.isCustom);
      buildCarousel();
      if (state.samples.length > 0) {
        loadSample(state.samples[0], false);
      }
    });
  }

  // Языковой переключатель (дропдаун)
  if (els.langBtn && els.langMenu) {
    els.langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.langMenu.classList.toggle('show');
    });

    document.querySelectorAll('.lang-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lang = btn.dataset.lang;
        setLanguage(lang);
        els.langMenu.classList.remove('show');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.lang-dropdown')) {
        els.langMenu.classList.remove('show');
      }
    });
  }

  // Переключатель темы
  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', () => {
      cycleTheme();
    });
  }

  // Вкладки режимов отображения
  const tabs = [
    { btn: els.tabDetected, mode: 'detected' },
    { btn: els.tabNormalized, mode: 'normalized' },
    { btn: els.tabOriginal, mode: 'original' }
  ];

  tabs.forEach(({ btn, mode }) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('is-active');
        t.btn.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      state.activeTab = mode;
      renderDisplay();
    });
  });

  // Кнопки запуска анализа
  els.btnRunStandard.addEventListener('click', () => {
    if (state.currentImage) processImage(state.currentImage, false);
  });

  els.btnRunExtended.addEventListener('click', () => {
    if (state.currentImage) processImage(state.currentImage, true);
  });

  // Пресеты Extended Mode
  els.extPresetSelect.addEventListener('change', (e) => {
    applyPreset(e.target.value);
  });

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
  }

  function syncPresetInputs() {
    els.extConfRange.value = state.extConf;
    els.extConfVal.textContent = state.extConf.toFixed(2);
    els.extStepRange.value = state.extSteps;
    els.extStepVal.textContent = `${state.extSteps} шагов`;
    els.extMinHitsRange.value = state.extMinHits;
    els.extMinHitsVal.textContent = `${state.extMinHits} спектра`;
    els.extIouRange.value = state.extIou;
    els.extIouVal.textContent = state.extIou.toFixed(2);
  }

  // Ручные ползунки Extended Mode
  els.extConfRange.addEventListener('input', (e) => {
    state.extConf = parseFloat(e.target.value);
    els.extConfVal.textContent = state.extConf.toFixed(2);
    els.extPresetSelect.value = 'custom';
  });

  els.extStepRange.addEventListener('input', (e) => {
    state.extSteps = parseInt(e.target.value, 10);
    els.extStepVal.textContent = `${state.extSteps} шагов`;
    els.extPresetSelect.value = 'custom';
  });

  els.extIouRange.addEventListener('input', (e) => {
    state.extIou = parseFloat(e.target.value);
    els.extIouVal.textContent = state.extIou.toFixed(2);
    els.extPresetSelect.value = 'custom';
  });

  els.extMinHitsRange.addEventListener('input', (e) => {
    state.extMinHits = parseInt(e.target.value, 10);
    els.extMinHitsVal.textContent = `${state.extMinHits} спектра`;
    els.extPresetSelect.value = 'custom';
  });

  // Ползунки одиночного режима (БЕЗ автозапуска детекции, обновление холста нормализации)
  els.confRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    els.confVal.textContent = val.toFixed(2);
    state.detector.confThreshold = val;
  });

  els.satRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    els.satVal.textContent = val.toFixed(2);
    state.normalizer.kSat = val;
    if (state.currentImage && els.normalizeToggle.checked) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      state.normalizer.process(els.normalizedCanvas);
      renderDisplay();
    }
  });

  els.whiteRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    els.whiteVal.textContent = val;
    state.normalizer.targetWhite = val;
    if (state.currentImage && els.normalizeToggle.checked) {
      els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
      state.normalizer.process(els.normalizedCanvas);
      renderDisplay();
    }
  });

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

// Загрузка пользовательского файла
function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Пожалуйста, выберите файл изображения (PNG, JPG, WebP).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const customId = `custom_${Date.now()}`;
    const customSample = {
      id: customId,
      name: file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name,
      path: e.target.result,
      isCustom: true
    };

    state.samples.unshift(customSample);
    buildCarousel();
    loadSample(customSample, false).then(() => {
      processImage(state.currentImage, true);
    });
  };
  reader.readAsDataURL(file);
}

// Старт приложения при готовности DOM
document.addEventListener('DOMContentLoaded', init);
