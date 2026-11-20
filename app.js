import { XrayNormalizer } from './xray-normalizer.js?v=9';
import {
  WebGPUExecutor,
  generateKSweepGrid,
  getOptimalWasmWorkerCount,
  fuseMultiSpectralBoxes,
  loadReferenceChw
} from './accel-engine.js?v=9';
import {
  PREF_STORAGE_KEYS,
  getCachedModelBuffer,
  getCachedSampleBlobUrl,
  listCustomSamples,
  saveCustomSample,
  deleteCustomSampleRecord,
  clearCustomSamplesStore,
  clearModelCache,
  clearSamplesCache,
  getCacheStats,
  clearAllPersistentCaches
} from './cache-store.js?v=9';

const DYNAMIC_MODEL_PATH = 'models/best_dynamic.onnx';

const BUILTIN_SAMPLES = [
  { id: 'image2', num: 2, hasGun: true, path: 'samples/image2.jpg', isCustom: false },
  { id: 'image3', num: 3, hasGun: false, path: 'samples/image3.png', isCustom: false },
  { id: 'image17', num: 17, hasGun: false, path: 'samples/image17.png', isCustom: false },
  { id: 'image9', num: 9, hasGun: true, path: 'samples/image9.png', isCustom: false },
  { id: 'image1', num: 1, hasGun: false, path: 'samples/image1.jpg', isCustom: false },
  { id: 'image4', num: 4, hasGun: false, path: 'samples/image4.png', isCustom: false },
  { id: 'image10', num: 10, hasGun: true, path: 'samples/image10.png', isCustom: false },
  { id: 'image18', num: 18, hasGun: true, path: 'samples/image18.png', isCustom: false },
  { id: 'image19', num: 19, hasGun: true, path: 'samples/image19.png', isCustom: false },
  { id: 'image20', num: 20, hasGun: true, path: 'samples/image20.png', isCustom: false },
  { id: 'image21', num: 21, hasGun: true, path: 'samples/image21.png', isCustom: false },
  { id: 'image22', num: 22, hasGun: true, path: 'samples/image22.png', isCustom: false },
  { id: 'image23', num: 23, hasGun: true, path: 'samples/image23.png', isCustom: false },
  { id: 'image24', num: 24, hasGun: true, path: 'samples/image24.png', isCustom: false }
];

const DEFAULT_SETTINGS = {
  scanMode: 'smart',
  extPreset: 'deep',
  extConf: 0.20,
  extSteps: 30,
  extMinHits: 2,
  extIou: 0.45,
  gridMargin: 0.10,
  gridStep: 0.05,
  singleConf: 0.35,
  kSat: 0.42,
  targetWhite: 248,
  normalize: true,
  imageSmoothingQuality: 'high',
  nmsIouThreshold: 0.45,
  smartMaxStage1: 10,
  smartWhisperConf: 0.00,
  distThresh: 55,
  gpuFramesPerCore: 2
};

// -----------------------------------------------------------------------------
// Мультиязычность (i18n): RU, BE, EN
// -----------------------------------------------------------------------------
const i18n = {
  ru: {
    docTitle: 'X-Ray Threat Scanner | On-Device Edge AI',
    langBtnTitle: 'Сменить язык',
    themeBtnTitle: 'Переключить тему оформления',
    hardwarePillTitle: 'Аппаратный ускоритель в браузере',
    hardwareLoading: 'Загрузка ядра...',
    hardwareStartingPool: 'Запуск пула ({n} ядер)...',
    hardwareWorkersProgress: 'Воркеры: {ready}/{total}...',
    hardwareRestoringGpu: 'Восстановление WebGPU...',
    hardwareWorkerError: 'Ошибка воркеров',
    heroAria: 'Инспектор снимка и режимы анализа',
    viewLayersAria: 'Слой отображения',
    samplesAria: 'Выбор снимка',
    scanModeAria: 'Режим сканирования',
    telemetryAria: 'Базовая телеметрия сканирования',
    paramsAria: 'Параметры ускорения и алгоритмов',
    authorAria: 'Об авторе',
    dropzoneAria: 'Загрузить свой рентген-снимок',
    dropzoneAction: 'Загрузить снимок',
    dropzoneOr: 'или перетащите сюда',
    galleryTitle: 'Лента снимков:',
    btnClearCustom: 'Очистить добавленные',
    samplesCounter: 'снимков',
    sampleWord: 'Снимок',
    sampleGunWord: 'Оружие',
    sampleDeleteAria: 'Удалить {name}',
    modeSmart: '⚡ Smart (Адаптивный)',
    modeExtended: '▷ Extended ({n} спектров)',
    modeSingle: '🎯 Одиночный (1 срез)',
    btnRunScan: '▶ Скан',
    bannerInitTitle: 'Инициализация движка...',
    bannerInitSub: 'Подготовка модели и воркеров',
    bannerReadyTitle: 'Движок готов · {profile}',
    bannerReadySub: 'Выберите снимок и нажмите «▶ Скан»',
    bannerLoadedTitle: 'Снимок загружен: {name}',
    bannerLoadedSub: '{w} × {h} px · Полярность: {pol} · Нажмите «▶ Скан»',
    bannerLoadedCached: '{w} × {h} px · Полярность: {pol} · Результат этой сессии',
    bannerInitError: 'Ошибка инициализации',
    progressWaiting: 'Ожидание...',
    tabDetected: 'С детекцией',
    tabNormalized: 'Нормализованный',
    tabOriginal: 'Исходный скан',
    tabRawPill: 'Исходный скан (Raw)',
    tabNormPill: 'Нормализованный (База)',
    threatWaiting: 'Ожидание снимка',
    threatNone: 'Угроз не обнаружено',
    threatDetected: 'УГРОЗА ОБНАРУЖЕНА',
    metricThreats: 'Детекции угроз',
    metricPolarity: 'Полярность кадра',
    metricInferTime: 'Время инференса',
    metricResolution: 'Размер снимка',
    positivePolarity: 'Позитив (Светлый фон)',
    negativePolarity: 'Негатив (Инвертирован)',
    polarityAuto: 'Автоопределение',
    inputFrame: 'Входной кадр',
    weaponDetected: 'Оружие (Пистолет)',
    accelSummary: 'Ускорение под девайс (WebGPU / Batching) и сетка k_sat',
    accelActiveProfile: 'Активный профиль движка',
    detecting: 'Определение...',
    btnRunCalib: '⚡ Ускорение под девайс',
    btnResetCalib: 'Сбросить',
    gridMarginLabel: 'Отступ от краёв k_sat (margin)',
    gridStepLabel: 'Шаг сетки k_sat (step)',
    gridFramesUnit: 'кадров',
    extSummary: 'Пороги уверенности, число срезов и слияние рамок (WBF)',
    extPresetLabel: 'Пресет мульти-сканирования',
    presetDeep: 'Глубокий анализ (Порог 20%, 30 шагов, 2 кадра)',
    presetParanoid: 'Параноидальный (Порог 15%, 20 шагов, 1 кадр)',
    presetBalanced: 'Сбалансированный (Порог 25%, 20 шагов, 2 кадра)',
    presetCustom: 'Пользовательский',
    extConfLabel: 'Порог уверенности спектров',
    extStepsLabel: 'Количество спектров (Extended)',
    extIouLabel: 'Фильтр слияния (IoU / WBF)',
    extMinHitsLabel: 'Мин. подтверждений',
    stepsUnit: 'шагов',
    spectraUnit: 'спектра',
    settingsSingleTitle: 'Параметры одиночного режима (White Balance & k_sat)',
    confThresholdLabel: 'Порог уверенности (Confidence)',
    satLabel: 'Десатурация (k_sat)',
    whitePointLabel: 'Точка белого (Target White)',
    normToggleLabel: 'Включить физическую нормализацию (полярность, фон, десатурация)',
    labSummary: 'Научные гиперпараметры (Скейлинг, NMS, Smart-эвристики, Порог GPU и Кэш)',
    smoothingLabel: 'Качество скейлинга (640×640 Letterbox)',
    smoothingHigh: 'High (бикубический — чёткие детали)',
    smoothingMedium: 'Medium (сбалансированный)',
    smoothingLow: 'Low (быстрый билинейный)',
    nmsIouLabel: 'Внутрикадровый NMS IoU',
    smartStage1Label: 'Smart: опорных срезов (Этап 1)',
    smartWhisperLabel: 'Smart: порог «шёпота» (0 = выкл)',
    distThreshLabel: 'Порог нейтрализации фона (distThresh)',
    gpuFramesPerCoreLabel: 'Порог GPU (кадров на 1 CPU-воркер)',
    cacheTitle: 'Локальный кэш (IndexedDB + профиль устройства)',
    cacheClearAll: 'Очистить весь кэш',
    cacheMenuAria: 'Выборочная очистка кэша',
    cacheClearModel: 'Очистить кэш модели (ONNX)',
    cacheClearSamples: 'Очистить кэш встроенных снимков',
    cacheClearCustom: 'Удалить загруженные фото',
    cacheClearPrefs: 'Сбросить профиль GPU и настройки',
    cacheClearAllMenu: 'Очистить всё и перезагрузить',
    cacheStatsFmt: 'Модель: {model} · Снимки: {samples} ({n}) · Загр.: {custom} ({c})',
    cacheClearedMsg: 'Кэш обновлён',
    cacheConfirmAll: 'Очистить весь кэш (модель, снимки, загруженные фото, профиль GPU и настройки алгоритмов) и перезагрузить страницу? Язык и тема сохранятся.',
    authorTag: 'Создатель',
    authorTitle: 'Об авторе проекта',
    authorName: 'Nikitos (@techno_c_a_t)',
    authorBio: 'Студент ПМИ, разработчик решений на C++, Python, Linux, Embedded и On-Device Edge AI. Автор проектов NSLDAI (Phantom), SwipeBeat и X-Ray Threat Scanner.',
    authorBtnPortfolio: 'Портфолио technocat.cc',
    authorBtnTelegram: 'Telegram',
    authorBtnGithub: 'GitHub',
    footerText: 'Архитектура YOLO11 nano · 100% On-Device WebGPU/WASM · Снимки не отправляются на сервер',
    calibModalTitle: 'Ускорение модели под ваш девайс...',
    calibModalSub: 'Проверка WebGPU и численного паритета',
    calibModalHint: 'Сверяем точность GPU с эталоном WASM',
    calibPrepRefModal: 'Подготовка эталонного теста GPU vs WASM...',
    calibCheckGpu: 'Проверка поддержки WebGPU...',
    calibPrepRef: 'Подготовка эталонного кадра для проверки паритета...',
    calibMeasureWasm: 'Замер эталона WASM для сверки GPU...',
    calibTestingCfg: 'Проверка {info} ({label}, batch=2)...',
    calibFallbackWasm: 'WebGPU отклонён (ошибка паритета) -> активен WASM-пул',
    calibTestingBatch4: '{label} batch=2 ок ({ms} мс). Тест batch=4...',
    calibRollbackBatch2: 'batch=4 не поместился в память GPU, откат на batch=2...',
    calibDoneGpu: 'Готово: WebGPU ({label}, batch={batch})',
    btnCancel: 'Прекратить',
    btnStop: 'Остановить',
    gpuModalTitle: 'Работает графический ускоритель (WebGPU)',
    gpuModalInit: 'Подготовка батчей...',
    gpuModalRun: 'Запуск {n} срезов на GPU (batch={b})...',
    gpuModalBatch: 'Батч {idx}/{total} · срезы {done}/{slices}',
    gpuModalEtaInit: 'ETA: замер первого батча...',
    gpuModalEtaValue: 'ETA: ~{sec} с ({ms} мс/батч)',
    gpuModalLagNote: 'Возможны кратковременные подтормаживания интерфейса, пока GPU загружен расчётом.',
    warnUnsupportedType: '⚠ Поддерживаются только изображения (PNG, JPG, WebP, BMP и др.).',
    warnPrefix: '⚠ Нестандартный снимок: ',
    warnLowRes: 'очень низкое разрешение ({w}×{h} px) — возможна нехватка деталей',
    warnHighRes: 'сверхвысокое разрешение ({w}×{h} px) — при сжатии в 640×640 мелкие объекты могут потеряться',
    warnAspect: 'нестандартное соотношение сторон ({aspect}:1) — большая доля серого паддинга',
    extBannerTitle: 'EXTENDED АНАЛИЗ ({n} СПЕКТРОВ)...',
    extBannerSubPrep: 'Подготовка срезов (порог GPU > {th} кадров)...',
    extProgressInit: 'Инициализация срезов...',
    extProgressDone: 'Завершено: {done}/{total} срезов',
    extDoneTitle: 'EXTENDED ЗАВЕРШЁН · Угроз: {hits}',
    extDoneSub: '{n} спектров · {backend} · {sec} с',
    scanStoppedTitle: 'Анализ остановлен пользователем',
    scanStoppedSub: 'Выберите снимок или запустите другой режим',
    scanErrorTitle: 'Ошибка анализа',
    singleTitle: 'ОДИНОЧНЫЙ СКАН...',
    singleSub: 'Инференс 1 среза на ядре CPU (WASM SIMD)...',
    singleDoneProgress: 'Одиночный срез завершён',
    singleDoneTitle: 'Одиночный скан завершён · Угроз: {hits}',
    singleDoneSub: 'CPU WASM (1 срез, k={k}): {infer} ms · Всего: {total} ms',
    singleErrorTitle: 'Ошибка одиночного скана',
    smartStage1Title: 'SMART: ЭТАП 1 ({n} опорных срезов)...',
    smartStage1Sub: 'Сетка [{a}..{b}], шаг {step} ({total} в сетке)',
    smartStage1Prog: 'Этап 1: {done}/{total}',
    smartStage2Title: 'SMART: ЭТАП 2 (+{n} срезов)...',
    smartStage2Found: 'Найдено в {hits} из {total} → уточнение соседей',
    smartStage2Empty: 'На первых {total} пусто → добор оставшихся',
    smartStage2Prog: 'Этап 2: {done}/{total}',
    smartDoneProg: 'Готово: {s1} + {s2} = {total} срезов',
    smartDoneTitle: 'SMART ЗАВЕРШЁН · Угроз: {hits} ({s1}+{s2} срезов)',
    smartDoneSub: '{reason} · {backend} · {sec} с',
    smartStoppedTitle: 'Smart-сканирование остановлено',
    smartStoppedSub: 'Прервано пользователем',
    smartErrorTitle: 'Ошибка Smart-сканирования',
    workersFmt: 'WASM SIMD ({n} воркеров)',
    workersShortFmt: 'WASM ({n} ядер)',
    gpuShortFmt: 'GPU B={b} + {n} CPU'
  },
  be: {
    docTitle: 'X-Ray Threat Scanner | On-Device Edge AI',
    langBtnTitle: 'Змяніць мову',
    themeBtnTitle: 'Пераключыць тэму афармлення',
    hardwarePillTitle: 'Апаратны паскаральнік у браўзеры',
    hardwareLoading: 'Загрузка ядра...',
    hardwareStartingPool: 'Запуск пула ({n} ядраў)...',
    hardwareWorkersProgress: 'Воркеры: {ready}/{total}...',
    hardwareRestoringGpu: 'Аднаўленне WebGPU...',
    hardwareWorkerError: 'Памылка воркераў',
    heroAria: 'Інспектар здымка і рэжымы аналізу',
    viewLayersAria: 'Пласт адлюстравання',
    samplesAria: 'Выбар здымка',
    scanModeAria: 'Рэжым сканавання',
    telemetryAria: 'Базавая тэлеметрыя сканавання',
    paramsAria: 'Параметры паскарэння і алгарытмаў',
    authorAria: 'Пра аўтара',
    dropzoneAria: 'Загрузіць свой рэнтген-здымак',
    dropzoneAction: 'Загрузіць здымак',
    dropzoneOr: 'ці перацягніце сюды',
    galleryTitle: 'Стужка здымкаў:',
    btnClearCustom: 'Ачысціць дададзеныя',
    samplesCounter: 'здымкаў',
    sampleWord: 'Здымак',
    sampleGunWord: 'Зброя',
    sampleDeleteAria: 'Выдаліць {name}',
    modeSmart: '⚡ Smart (Адаптыўны)',
    modeExtended: '▷ Extended ({n} спектраў)',
    modeSingle: '🎯 Адзіночны (1 зрэз)',
    btnRunScan: '▶ Скан',
    bannerInitTitle: 'Ініцыялізацыя рухавіка...',
    bannerInitSub: 'Падрыхтоўка мадэлі і воркераў',
    bannerReadyTitle: 'Рухавік гатовы · {profile}',
    bannerReadySub: 'Выберыце здымак і націсніце «▶ Скан»',
    bannerLoadedTitle: 'Здымак загружаны: {name}',
    bannerLoadedSub: '{w} × {h} px · Палярнасць: {pol} · Націсніце «▶ Скан»',
    bannerLoadedCached: '{w} × {h} px · Палярнасць: {pol} · Вынік гэтай сесіі',
    bannerInitError: 'Памылка ініцыялізацыі',
    progressWaiting: 'Чаканне...',
    tabDetected: 'З дэтэкцыяй',
    tabNormalized: 'Нармалізаваны',
    tabOriginal: 'Зыходны скан',
    tabRawPill: 'Зыходны скан (Raw)',
    tabNormPill: 'Нармалізаваны (База)',
    threatWaiting: 'Чаканне здымка',
    threatNone: 'Пагроз не выяўлена',
    threatDetected: 'ПАГРОЗА ВЫЯЎЛЕНА',
    metricThreats: 'Дэтэкцыі пагроз',
    metricPolarity: 'Палярнасць кадра',
    metricInferTime: 'Час інферэнсу',
    metricResolution: 'Памер здымка',
    positivePolarity: 'Пазітыў (Светлы фон)',
    negativePolarity: 'Негатыў (Інвертаваны)',
    polarityAuto: 'Аўтавызначэнне',
    inputFrame: 'Уваходны кадр',
    weaponDetected: 'Зброя (Пісталет)',
    accelSummary: 'Паскарэнне пад прыладу (WebGPU / Batching) і сетка k_sat',
    accelActiveProfile: 'Актыўны профіль рухавіка',
    detecting: 'Вызначэнне...',
    btnRunCalib: '⚡ Паскарэнне пад прыладу',
    btnResetCalib: 'Скінуць',
    gridMarginLabel: 'Водступ ад краёў k_sat (margin)',
    gridStepLabel: 'Крок сеткі k_sat (step)',
    gridFramesUnit: 'кадраў',
    extSummary: 'Парогі ўпэўненасці, колькасць зрэзаў і зліццё рамак (WBF)',
    extPresetLabel: 'Прэсет мульці-сканавання',
    presetDeep: 'Глыбокі аналіз (Парог 20%, 30 крокаў, 2 кадры)',
    presetParanoid: 'Паранаідальны (Парог 15%, 20 крокаў, 1 кадр)',
    presetBalanced: 'Збалансаваны (Парог 25%, 20 крокаў, 2 кадры)',
    presetCustom: 'Карыстальніцкі',
    extConfLabel: 'Парог упэўненасці спектраў',
    extStepsLabel: 'Колькасць спектраў (Extended)',
    extIouLabel: 'Фільтр зліцця (IoU / WBF)',
    extMinHitsLabel: 'Мін. пацверджанняў',
    stepsUnit: 'крокаў',
    spectraUnit: 'спектра',
    settingsSingleTitle: 'Параметры адзіночнага рэжыму (White Balance & k_sat)',
    confThresholdLabel: 'Парог упэўненасці (Confidence)',
    satLabel: 'Дэсатурацыя (k_sat)',
    whitePointLabel: 'Пункт белага (Target White)',
    normToggleLabel: 'Уключыць фізічную нармалізацыю (палярнасць, фон, дэсатурацыя)',
    labSummary: 'Навуковыя гіперпараметры (Скейлінг, NMS, Smart-эўрыстыкі, Парог GPU і Кэш)',
    smoothingLabel: 'Якасць скейлінгу (640×640 Letterbox)',
    smoothingHigh: 'High (бікубічны — выразныя дэталі)',
    smoothingMedium: 'Medium (збалансаваны)',
    smoothingLow: 'Low (хуткі білінейны)',
    nmsIouLabel: 'Унутрыкадравы NMS IoU',
    smartStage1Label: 'Smart: апорных зрэзаў (Этап 1)',
    smartWhisperLabel: 'Smart: парог «шэпту» (0 = выкл)',
    distThreshLabel: 'Парог нейтралізацыі фону (distThresh)',
    gpuFramesPerCoreLabel: 'Парог GPU (кадраў на 1 CPU-воркер)',
    cacheTitle: 'Лакальны кэш (IndexedDB + профіль прылады)',
    cacheClearAll: 'Ачысціць увесь кэш',
    cacheMenuAria: 'Выбарачная ачыстка кэша',
    cacheClearModel: 'Ачысціць кэш мадэлі (ONNX)',
    cacheClearSamples: 'Ачысціць кэш убудаваных здымкаў',
    cacheClearCustom: 'Выдаліць загружаныя фота',
    cacheClearPrefs: 'Скінуць профіль GPU і налады',
    cacheClearAllMenu: 'Ачысціць усё і перазагрузіць',
    cacheStatsFmt: 'Мадэль: {model} · Здымкі: {samples} ({n}) · Загр.: {custom} ({c})',
    cacheClearedMsg: 'Кэш абноўлены',
    cacheConfirmAll: 'Ачысціць увесь кэш (мадэль, здымкі, загружаныя фота, профіль GPU і налады алгарытмаў) і перазагрузіць старонку? Мова і тэма захаваюцца.',
    authorTag: 'Стваральнік',
    authorTitle: 'Пра аўтара праекта',
    authorName: 'Nikitos (@techno_c_a_t)',
    authorBio: 'Студэнт ПМІ, распрацоўшчык рашэнняў на C++, Python, Linux, Embedded і On-Device Edge AI. Аўтар праектаў NSLDAI (Phantom), SwipeBeat і X-Ray Threat Scanner.',
    authorBtnPortfolio: 'Партфоліа technocat.cc',
    authorBtnTelegram: 'Telegram',
    authorBtnGithub: 'GitHub',
    footerText: 'Архітэктура YOLO11 nano · 100% On-Device WebGPU/WASM · Здымкі не адпраўляюцца на сервер',
    calibModalTitle: 'Паскарэнне мадэлі пад вашу прыладу...',
    calibModalSub: 'Праверка WebGPU і лікавага парытэту',
    calibModalHint: 'Звяраем дакладнасць GPU з эталонам WASM',
    calibPrepRefModal: 'Падрыхтоўка эталоннага тэсту GPU vs WASM...',
    calibCheckGpu: 'Праверка падтрымкі WebGPU...',
    calibPrepRef: 'Падрыхтоўка эталоннага кадра для праверкі парытэту...',
    calibMeasureWasm: 'Замер эталона WASM для зверкі GPU...',
    calibTestingCfg: 'Праверка {info} ({label}, batch=2)...',
    calibFallbackWasm: 'WebGPU адхілены (памылка парытэту) -> актыўны WASM-пул',
    calibTestingBatch4: '{label} batch=2 ок ({ms} мс). Тэст batch=4...',
    calibRollbackBatch2: 'batch=4 не змясціўся ў памяць GPU, адкат на batch=2...',
    calibDoneGpu: 'Гатова: WebGPU ({label}, batch={batch})',
    btnCancel: 'Спыніць',
    btnStop: 'Спыніць',
    gpuModalTitle: 'Працуе графічны паскаральнік (WebGPU)',
    gpuModalInit: 'Падрыхтоўка батчаў...',
    gpuModalRun: 'Запуск {n} зрэзаў на GPU (batch={b})...',
    gpuModalBatch: 'Батч {idx}/{total} · зрэзы {done}/{slices}',
    gpuModalEtaInit: 'ETA: замер першага батча...',
    gpuModalEtaValue: 'ETA: ~{sec} с ({ms} мс/батч)',
    gpuModalLagNote: 'Магчымыя кароткачасовыя затрымкі інтэрфейсу, пакуль GPU заняты разлікам.',
    warnUnsupportedType: '⚠ Падтрымліваюцца толькі выявы (PNG, JPG, WebP, BMP і інш.).',
    warnPrefix: '⚠ Нестандартны здымак: ',
    warnLowRes: 'вельмі нізкае разрозненне ({w}×{h} px) — магчымы недахоп дэталяў',
    warnHighRes: 'звышвысокае разрозненне ({w}×{h} px) — пры сцісканні да 640×640 дробныя аб’екты могуць згубіцца',
    warnAspect: 'нестандартныя суадносіны бакоў ({aspect}:1) — вялікая доля шэрага падзінгу',
    extBannerTitle: 'EXTENDED АНАЛІЗ ({n} СПЕКТРАЎ)...',
    extBannerSubPrep: 'Падрыхтоўка зрэзаў (парог GPU > {th} кадраў)...',
    extProgressInit: 'Ініцыялізацыя зрэзаў...',
    extProgressDone: 'Завершана: {done}/{total} зрэзаў',
    extDoneTitle: 'EXTENDED ЗАВЕРШАНЫ · Пагроз: {hits}',
    extDoneSub: '{n} спектраў · {backend} · {sec} с',
    scanStoppedTitle: 'Аналіз спынены карыстальнікам',
    scanStoppedSub: 'Выберыце здымак ці запусціце іншы рэжым',
    scanErrorTitle: 'Памылка аналізу',
    singleTitle: 'АДЗІНОЧНЫ СКАН...',
    singleSub: 'Інферэнс 1 зрэзу на ядры CPU (WASM SIMD)...',
    singleDoneProgress: 'Адзіночны зрэз завершаны',
    singleDoneTitle: 'Адзіночны скан завершаны · Пагроз: {hits}',
    singleDoneSub: 'CPU WASM (1 зрэз, k={k}): {infer} ms · Усяго: {total} ms',
    singleErrorTitle: 'Памылка адзіночнага скана',
    smartStage1Title: 'SMART: ЭТАП 1 ({n} апорных зрэзаў)...',
    smartStage1Sub: 'Сетка [{a}..{b}], крок {step} ({total} у сетцы)',
    smartStage1Prog: 'Этап 1: {done}/{total}',
    smartStage2Title: 'SMART: ЭТАП 2 (+{n} зрэзаў)...',
    smartStage2Found: 'Знойдзена ў {hits} з {total} → удакладненне суседзяў',
    smartStage2Empty: 'На першых {total} пуста → дабор астатніх',
    smartStage2Prog: 'Этап 2: {done}/{total}',
    smartDoneProg: 'Гатова: {s1} + {s2} = {total} зрэзаў',
    smartDoneTitle: 'SMART ЗАВЕРШАНЫ · Пагроз: {hits} ({s1}+{s2} зрэзаў)',
    smartDoneSub: '{reason} · {backend} · {sec} с',
    smartStoppedTitle: 'Smart-сканаванне спынена',
    smartStoppedSub: 'Перапынена карыстальнікам',
    smartErrorTitle: 'Памылка Smart-сканавання',
    workersFmt: 'WASM SIMD ({n} воркераў)',
    workersShortFmt: 'WASM ({n} ядраў)',
    gpuShortFmt: 'GPU B={b} + {n} CPU'
  },
  en: {
    docTitle: 'X-Ray Threat Scanner | On-Device Edge AI',
    langBtnTitle: 'Change language',
    themeBtnTitle: 'Toggle theme',
    hardwarePillTitle: 'In-browser hardware accelerator',
    hardwareLoading: 'Loading engine...',
    hardwareStartingPool: 'Starting pool ({n} cores)...',
    hardwareWorkersProgress: 'Workers: {ready}/{total}...',
    hardwareRestoringGpu: 'Restoring WebGPU...',
    hardwareWorkerError: 'Worker error',
    heroAria: 'Scan inspector and analysis modes',
    viewLayersAria: 'Display layer',
    samplesAria: 'Select scan',
    scanModeAria: 'Scan mode',
    telemetryAria: 'Basic scan telemetry',
    paramsAria: 'Acceleration and algorithm parameters',
    authorAria: 'About the author',
    dropzoneAria: 'Upload custom X-ray image',
    dropzoneAction: 'Upload scan',
    dropzoneOr: 'or drag and drop here',
    galleryTitle: 'Scan Feed:',
    btnClearCustom: 'Clear Uploaded',
    samplesCounter: 'images',
    sampleWord: 'Scan',
    sampleGunWord: 'Weapon',
    sampleDeleteAria: 'Delete {name}',
    modeSmart: '⚡ Smart (Adaptive)',
    modeExtended: '▷ Extended ({n} spectra)',
    modeSingle: '🎯 Single (1 slice)',
    btnRunScan: '▶ Scan',
    bannerInitTitle: 'Initializing engine...',
    bannerInitSub: 'Preparing model and worker pool',
    bannerReadyTitle: 'Engine ready · {profile}',
    bannerReadySub: 'Pick a scan and press "▶ Scan"',
    bannerLoadedTitle: 'Scan loaded: {name}',
    bannerLoadedSub: '{w} × {h} px · Polarity: {pol} · Press "▶ Scan"',
    bannerLoadedCached: '{w} × {h} px · Polarity: {pol} · Session result',
    bannerInitError: 'Initialization error',
    progressWaiting: 'Waiting...',
    tabDetected: 'Detections',
    tabNormalized: 'Normalized',
    tabOriginal: 'Original Scan',
    tabRawPill: 'Original Scan (Raw)',
    tabNormPill: 'Normalized (Base)',
    threatWaiting: 'Waiting for scan',
    threatNone: 'No threats detected',
    threatDetected: 'THREAT DETECTED',
    metricThreats: 'Threat Detections',
    metricPolarity: 'Frame Polarity',
    metricInferTime: 'Inference Latency',
    metricResolution: 'Image Resolution',
    positivePolarity: 'Positive (Light BG)',
    negativePolarity: 'Negative (Inverted)',
    polarityAuto: 'Auto-detection',
    inputFrame: 'Input Frame',
    weaponDetected: 'Firearm (Gun)',
    accelSummary: 'Device Acceleration (WebGPU / Batching) & k_sat Grid',
    accelActiveProfile: 'Active engine profile',
    detecting: 'Detecting...',
    btnRunCalib: '⚡ Accelerate for Device',
    btnResetCalib: 'Reset',
    gridMarginLabel: 'k_sat edge margin',
    gridStepLabel: 'k_sat grid step',
    gridFramesUnit: 'frames',
    extSummary: 'Confidence Thresholds, Slice Count & Box Fusion (WBF)',
    extPresetLabel: 'Multi-Scan Preset',
    presetDeep: 'Deep Analysis (Conf 20%, 30 steps, 2 hits)',
    presetParanoid: 'Paranoid (Conf 15%, 20 steps, 1 hit)',
    presetBalanced: 'Balanced (Conf 25%, 20 steps, 2 hits)',
    presetCustom: 'Custom',
    extConfLabel: 'Spectral Confidence Threshold',
    extStepsLabel: 'Spectra Count (Extended)',
    extIouLabel: 'Fusion Filter (IoU / WBF)',
    extMinHitsLabel: 'Min Hits Threshold',
    stepsUnit: 'steps',
    spectraUnit: 'hits',
    settingsSingleTitle: 'Single Mode Parameters (White Balance & k_sat)',
    confThresholdLabel: 'Confidence Threshold',
    satLabel: 'Desaturation (k_sat)',
    whitePointLabel: 'Target White Point',
    normToggleLabel: 'Enable physical normalization (polarity, background, desaturation)',
    labSummary: 'Research Hyperparameters (Scaling, NMS, Smart Heuristics, GPU Threshold & Cache)',
    smoothingLabel: 'Scaling Quality (640×640 Letterbox)',
    smoothingHigh: 'High (bicubic — sharp details)',
    smoothingMedium: 'Medium (balanced)',
    smoothingLow: 'Low (fast bilinear)',
    nmsIouLabel: 'Per-Frame NMS IoU',
    smartStage1Label: 'Smart: anchor slices (Stage 1)',
    smartWhisperLabel: 'Smart: "whisper" threshold (0 = off)',
    distThreshLabel: 'Background neutralization threshold (distThresh)',
    gpuFramesPerCoreLabel: 'GPU Threshold (frames per CPU worker)',
    cacheTitle: 'Local Cache (IndexedDB + Device Profile)',
    cacheClearAll: 'Clear all cache',
    cacheMenuAria: 'Selective cache clearing',
    cacheClearModel: 'Clear model cache (ONNX)',
    cacheClearSamples: 'Clear built-in samples cache',
    cacheClearCustom: 'Delete uploaded images',
    cacheClearPrefs: 'Reset GPU profile & settings',
    cacheClearAllMenu: 'Clear everything and reload',
    cacheStatsFmt: 'Model: {model} · Samples: {samples} ({n}) · Uploads: {custom} ({c})',
    cacheClearedMsg: 'Cache updated',
    cacheConfirmAll: 'Clear all cached data (ONNX model, sample images, uploaded images, GPU calibration profile, and algorithm settings) and reload? Language and theme will be kept.',
    authorTag: 'Creator',
    authorTitle: 'About the Author',
    authorName: 'Nikitos (@techno_c_a_t)',
    authorBio: 'Applied Math & CS student, developer specializing in C++, Python, Linux, Embedded, and On-Device Edge AI. Creator of NSLDAI (Phantom), SwipeBeat, and X-Ray Threat Scanner.',
    authorBtnPortfolio: 'Portfolio technocat.cc',
    authorBtnTelegram: 'Telegram',
    authorBtnGithub: 'GitHub',
    footerText: 'YOLO11 nano architecture · 100% On-Device WebGPU/WASM · Scans never leave your device',
    calibModalTitle: 'Calibrating acceleration for your device...',
    calibModalSub: 'Testing WebGPU & numerical parity',
    calibModalHint: 'Verifying GPU accuracy against WASM reference',
    calibPrepRefModal: 'Preparing GPU vs WASM reference test...',
    calibCheckGpu: 'Checking WebGPU support...',
    calibPrepRef: 'Preparing reference frame for parity check...',
    calibMeasureWasm: 'Measuring WASM baseline for GPU parity...',
    calibTestingCfg: 'Testing {info} ({label}, batch=2)...',
    calibFallbackWasm: 'WebGPU rejected (parity check) -> using WASM pool',
    calibTestingBatch4: '{label} batch=2 ok ({ms} ms). Testing batch=4...',
    calibRollbackBatch2: 'batch=4 exceeded GPU memory, falling back to batch=2...',
    calibDoneGpu: 'Ready: WebGPU ({label}, batch={batch})',
    btnCancel: 'Abort',
    btnStop: 'Stop',
    gpuModalTitle: 'GPU Accelerator Running (WebGPU)',
    gpuModalInit: 'Preparing batches...',
    gpuModalRun: 'Running {n} slices on GPU (batch={b})...',
    gpuModalBatch: 'Batch {idx}/{total} · slices {done}/{slices}',
    gpuModalEtaInit: 'ETA: measuring first batch...',
    gpuModalEtaValue: 'ETA: ~{sec} s ({ms} ms/batch)',
    gpuModalLagNote: 'Brief UI pauses may occur while the GPU processes batches.',
    warnUnsupportedType: '⚠ Only image files are supported (PNG, JPG, WebP, BMP, etc.).',
    warnPrefix: '⚠ Unusual scan dimensions: ',
    warnLowRes: 'very low resolution ({w}×{h} px) — details may be missing',
    warnHighRes: 'ultra-high resolution ({w}×{h} px) — small objects may blur when resized to 640×640',
    warnAspect: 'extreme aspect ratio ({aspect}:1) — large gray letterbox padding',
    extBannerTitle: 'EXTENDED ANALYSIS ({n} SPECTRA)...',
    extBannerSubPrep: 'Preparing slices (GPU threshold > {th} frames)...',
    extProgressInit: 'Initializing slices...',
    extProgressDone: 'Completed: {done}/{total} slices',
    extDoneTitle: 'EXTENDED COMPLETE · Threats: {hits}',
    extDoneSub: '{n} spectra · {backend} · {sec} s',
    scanStoppedTitle: 'Scan stopped by user',
    scanStoppedSub: 'Pick another scan or run another mode',
    scanErrorTitle: 'Scan error',
    singleTitle: 'SINGLE SCAN...',
    singleSub: 'Running 1 slice on CPU worker (WASM SIMD)...',
    singleDoneProgress: 'Single slice complete',
    singleDoneTitle: 'Single scan complete · Threats: {hits}',
    singleDoneSub: 'CPU WASM (1 slice, k={k}): {infer} ms · Total: {total} ms',
    singleErrorTitle: 'Single scan error',
    smartStage1Title: 'SMART: STAGE 1 ({n} anchor slices)...',
    smartStage1Sub: 'Grid [{a}..{b}], step {step} ({total} in grid)',
    smartStage1Prog: 'Stage 1: {done}/{total}',
    smartStage2Title: 'SMART: STAGE 2 (+{n} slices)...',
    smartStage2Found: 'Found in {hits}/{total} → refining neighbors',
    smartStage2Empty: 'Empty on first {total} → checking remaining',
    smartStage2Prog: 'Stage 2: {done}/{total}',
    smartDoneProg: 'Done: {s1} + {s2} = {total} slices',
    smartDoneTitle: 'SMART COMPLETE · Threats: {hits} ({s1}+{s2} slices)',
    smartDoneSub: '{reason} · {backend} · {sec} s',
    smartStoppedTitle: 'Smart scan stopped',
    smartStoppedSub: 'Aborted by user',
    smartErrorTitle: 'Smart scan error',
    workersFmt: 'WASM SIMD ({n} workers)',
    workersShortFmt: 'WASM ({n} cores)',
    gpuShortFmt: 'GPU B={b} + {n} CPU'
  }
};

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

function t(key, vars = {}) {
  const dict = i18n[currentLang] || i18n.ru;
  let str = dict[key] ?? i18n.ru[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

const THEMES = ['dark', 'light', 'cyber'];
const THEME_ICONS = { dark: '🌙', light: '☀️', cyber: '⚡' };

function detectTheme() {
  const saved = localStorage.getItem('xray_theme');
  if (saved && THEMES.includes(saved)) return saved;
  return 'dark';
}

let currentTheme = detectTheme();

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const initialSettings = loadSavedSettings();

const HARDWARE_CORES = navigator.hardwareConcurrency || 4;
const WORKER_COUNT = getOptimalWasmWorkerCount();

const state = {
  samples: [...BUILTIN_SAMPLES],
  currentImageId: null,
  currentImage: null,
  currentWidth: 0,
  currentHeight: 0,
  scanResults: {}, // Сессионный кэш результатов (сбрасывается при перезагрузке страницы)
  activeView: 'detected',
  boxes: [],
  polarityInfo: null,
  metrics: null,
  hardwareCores: HARDWARE_CORES,
  workerCount: WORKER_COUNT,
  pool: null,
  gpuExecutor: null,
  modelBuffer: null,
  calibAbortController: null,
  scanAbortController: null,
  isScanning: false,
  normalizer: new XrayNormalizer({
    kSat: initialSettings.kSat,
    targetWhite: initialSettings.targetWhite,
    distThresh: initialSettings.distThresh
  }),
  scanMode: initialSettings.scanMode,
  extPreset: initialSettings.extPreset,
  extConf: initialSettings.extConf,
  extSteps: initialSettings.extSteps,
  extMinHits: initialSettings.extMinHits,
  extIou: initialSettings.extIou,
  gridMargin: initialSettings.gridMargin,
  gridStep: initialSettings.gridStep,
  singleConf: initialSettings.singleConf,
  normalizeEnabled: initialSettings.normalize,
  imageSmoothingQuality: initialSettings.imageSmoothingQuality,
  nmsIouThreshold: initialSettings.nmsIouThreshold,
  smartMaxStage1: initialSettings.smartMaxStage1,
  smartWhisperConf: initialSettings.smartWhisperConf,
  gpuFramesPerCore: initialSettings.gpuFramesPerCore
};
window.state = state;

function saveSettings() {
  try {
    const payload = {
      scanMode: state.scanMode,
      extPreset: state.extPreset,
      extConf: state.extConf,
      extSteps: state.extSteps,
      extMinHits: state.extMinHits,
      extIou: state.extIou,
      gridMargin: state.gridMargin,
      gridStep: state.gridStep,
      singleConf: state.singleConf,
      kSat: state.normalizer.kSat,
      targetWhite: state.normalizer.targetWhite,
      normalize: state.normalizeEnabled,
      imageSmoothingQuality: state.imageSmoothingQuality,
      nmsIouThreshold: state.nmsIouThreshold,
      smartMaxStage1: state.smartMaxStage1,
      smartWhisperConf: state.smartWhisperConf,
      distThresh: state.normalizer.distThresh,
      gpuFramesPerCore: state.gpuFramesPerCore
    };
    localStorage.setItem(PREF_STORAGE_KEYS.settings, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

const els = {
  hardwareStatus: document.getElementById('hardwareStatus'),
  statusDot: document.getElementById('statusDot'),
  langBtn: document.getElementById('langBtn'),
  langMenu: document.getElementById('langMenu'),
  currentLangLabel: document.getElementById('currentLangLabel'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  samplesCarousel: document.getElementById('samplesCarousel'),
  samplesCounter: document.getElementById('samplesCounter'),
  btnClearCustom: document.getElementById('btnClearCustom'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  resolutionWarning: document.getElementById('resolutionWarning'),
  scanModeSelect: document.getElementById('scanModeSelect'),
  optExtendedMode: document.getElementById('optExtendedMode'),
  btnRunScan: document.getElementById('btnRunScan'),
  inferStatusBanner: document.getElementById('inferStatusBanner'),
  bannerSpinner: document.getElementById('bannerSpinner'),
  bannerTitle: document.getElementById('bannerTitle'),
  bannerSub: document.getElementById('bannerSub'),
  bannerMetric: document.getElementById('bannerMetric'),
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  displayCanvas: document.getElementById('displayCanvas'),
  normalizedCanvas: document.getElementById('normalizedCanvas'),
  originalCanvas: document.getElementById('originalCanvas'),
  threatBadge: document.getElementById('threatBadge'),
  threatText: document.getElementById('threatText'),
  tabDetected: document.getElementById('tabDetected'),
  tabNormalized: document.getElementById('tabNormalized'),
  tabOriginal: document.getElementById('tabOriginal'),
  threatCount: document.getElementById('threatCount'),
  threatDetail: document.getElementById('threatDetail'),
  polarityStatus: document.getElementById('polarityStatus'),
  polarityDetail: document.getElementById('polarityDetail'),
  inferTime: document.getElementById('inferTime'),
  inferBackend: document.getElementById('inferBackend'),
  imageResolution: document.getElementById('imageResolution'),
  accelProfileVal: document.getElementById('accelProfileVal'),
  btnRunCalibration: document.getElementById('btnRunCalibration'),
  btnResetCalib: document.getElementById('btnResetCalib'),
  gridMarginRange: document.getElementById('gridMarginRange'),
  gridMarginVal: document.getElementById('gridMarginVal'),
  gridStepRange: document.getElementById('gridStepRange'),
  gridStepVal: document.getElementById('gridStepVal'),
  extPresetSelect: document.getElementById('extPresetSelect'),
  extConfRange: document.getElementById('extConfRange'),
  extConfVal: document.getElementById('extConfVal'),
  extStepRange: document.getElementById('extStepRange'),
  extStepVal: document.getElementById('extStepVal'),
  extIouRange: document.getElementById('extIouRange'),
  extIouVal: document.getElementById('extIouVal'),
  extMinHitsRange: document.getElementById('extMinHitsRange'),
  extMinHitsVal: document.getElementById('extMinHitsVal'),
  confRange: document.getElementById('confRange'),
  confVal: document.getElementById('confVal'),
  satRange: document.getElementById('satRange'),
  satVal: document.getElementById('satVal'),
  whiteRange: document.getElementById('whiteRange'),
  whiteVal: document.getElementById('whiteVal'),
  normalizeToggle: document.getElementById('normalizeToggle'),
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
  cacheStatsText: document.getElementById('cacheStatsText'),
  btnClearCacheAll: document.getElementById('btnClearCacheAll'),
  btnCacheMenuToggle: document.getElementById('btnCacheMenuToggle'),
  cacheClearMenu: document.getElementById('cacheClearMenu'),
  calibModal: document.getElementById('calibModal'),
  calibModalSub: document.getElementById('calibModalSub'),
  calibProgressFill: document.getElementById('calibProgressFill'),
  btnCancelCalib: document.getElementById('btnCancelCalib'),
  gpuWorkModal: document.getElementById('gpuWorkModal'),
  gpuWorkSub: document.getElementById('gpuWorkSub'),
  gpuWorkEta: document.getElementById('gpuWorkEta'),
  gpuWorkProgressFill: document.getElementById('gpuWorkProgressFill'),
  btnCancelGpuWork: document.getElementById('btnCancelGpuWork')
};

// -----------------------------------------------------------------------------
// Пул параллельных Web Workers (прогрев воркера #0 -> Promise.allSettled)
// -----------------------------------------------------------------------------
class ParallelWorkerPool {
  constructor(size, modelPath, modelBuffer = null) {
    this.size = size;
    this.modelPath = modelPath;
    this.modelBuffer = modelBuffer;
    this.workers = [];
    this.idleWorkers = [];
  }

  async init(onProgress) {
    let readyCount = 0;

    const spawnOne = (i) => new Promise((resolve, reject) => {
      const w = new Worker('./inference-worker.js?v=9');
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

      const bufCopy = this.modelBuffer instanceof ArrayBuffer ? this.modelBuffer.slice(0) : null;
      const transfer = bufCopy ? [bufCopy] : [];
      w.postMessage(
        { type: 'init', payload: { workerId: i, modelPath: this.modelPath, modelBuffer: bufCopy } },
        transfer
      );
    });

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
// Утилиты локализации, тем и форматирования
// -----------------------------------------------------------------------------
function getSampleDisplayName(sample) {
  if (sample.isCustom) return sample.name;
  const gunNote = sample.hasGun ? ` (${t('sampleGunWord')})` : '';
  return `${t('sampleWord')} ${sample.num}${gunNote}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshCacheStats() {
  if (!els.cacheStatsText) return;
  const stats = await getCacheStats();
  els.cacheStatsText.textContent = t('cacheStatsFmt', {
    model: formatBytes(stats.modelBytes),
    samples: formatBytes(stats.samplesBytes),
    n: stats.samplesCount,
    custom: formatBytes(stats.customBytes),
    c: stats.customCount
  });
}

function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'dark';
  currentTheme = theme;
  try {
    localStorage.setItem('xray_theme', theme);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', theme);
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

function updateGridStepLabel() {
  if (!els.gridStepVal) return;
  const grid = generateKSweepGrid({ margin: state.gridMargin, step: state.gridStep });
  els.gridStepVal.textContent = `${state.gridStep.toFixed(2)} (${grid.length} ${t('gridFramesUnit')})`;
}

function updateRunButtonText() {
  if (els.optExtendedMode) {
    els.optExtendedMode.textContent = t('modeExtended', { n: state.extSteps });
  }
}

function syncAllInputsFromState() {
  if (els.scanModeSelect) els.scanModeSelect.value = state.scanMode;
  if (els.extPresetSelect) els.extPresetSelect.value = state.extPreset;
  if (els.extConfRange) els.extConfRange.value = state.extConf;
  if (els.extConfVal) els.extConfVal.textContent = state.extConf.toFixed(2);
  if (els.extStepRange) els.extStepRange.value = state.extSteps;
  if (els.extStepVal) els.extStepVal.textContent = `${state.extSteps} ${t('stepsUnit')}`;
  if (els.extMinHitsRange) els.extMinHitsRange.value = state.extMinHits;
  if (els.extMinHitsVal) els.extMinHitsVal.textContent = `${state.extMinHits} ${t('spectraUnit')}`;
  if (els.extIouRange) els.extIouRange.value = state.extIou;
  if (els.extIouVal) els.extIouVal.textContent = state.extIou.toFixed(2);
  if (els.gridMarginRange) els.gridMarginRange.value = state.gridMargin;
  if (els.gridMarginVal) els.gridMarginVal.textContent = state.gridMargin.toFixed(2);
  if (els.gridStepRange) els.gridStepRange.value = state.gridStep;
  updateGridStepLabel();
  updateRunButtonText();

  if (els.confRange) els.confRange.value = state.singleConf;
  if (els.confVal) els.confVal.textContent = state.singleConf.toFixed(2);
  if (els.satRange) els.satRange.value = state.normalizer.kSat;
  if (els.satVal) els.satVal.textContent = state.normalizer.kSat.toFixed(2);
  if (els.whiteRange) els.whiteRange.value = state.normalizer.targetWhite;
  if (els.whiteVal) els.whiteVal.textContent = String(state.normalizer.targetWhite);
  if (els.normalizeToggle) els.normalizeToggle.checked = state.normalizeEnabled;

  if (els.smoothingSelect) els.smoothingSelect.value = state.imageSmoothingQuality;
  if (els.nmsIouRange) els.nmsIouRange.value = state.nmsIouThreshold;
  if (els.nmsIouVal) els.nmsIouVal.textContent = state.nmsIouThreshold.toFixed(2);
  if (els.smartStage1Range) els.smartStage1Range.value = state.smartMaxStage1;
  if (els.smartStage1Val) els.smartStage1Val.textContent = String(state.smartMaxStage1);
  if (els.smartWhisperRange) els.smartWhisperRange.value = state.smartWhisperConf;
  if (els.smartWhisperVal) els.smartWhisperVal.textContent = state.smartWhisperConf.toFixed(2);
  if (els.distThreshRange) els.distThreshRange.value = state.normalizer.distThresh;
  if (els.distThreshVal) els.distThreshVal.textContent = String(state.normalizer.distThresh);
  if (els.gpuFramesPerCoreRange) els.gpuFramesPerCoreRange.value = state.gpuFramesPerCore;
  if (els.gpuFramesPerCoreVal) els.gpuFramesPerCoreVal.textContent = String(state.gpuFramesPerCore);
}

function updateAccelBadge() {
  if (!els.accelProfileVal) return;
  if (state.gpuExecutor && state.gpuExecutor.isReady) {
    const layoutTag = state.gpuExecutor.preferredLayout || 'auto';
    els.accelProfileVal.textContent = `WebGPU · B=${state.gpuExecutor.batchSize} (${layoutTag}/${state.gpuExecutor.optLevel})`;
    els.hardwareStatus.textContent = t('gpuShortFmt', { b: state.gpuExecutor.batchSize, n: state.workerCount });
  } else {
    els.accelProfileVal.textContent = t('workersFmt', { n: state.workerCount });
    els.hardwareStatus.textContent = t('workersShortFmt', { n: state.workerCount });
  }
}

function setLanguage(lang) {
  if (!i18n[lang]) return;
  currentLang = lang;
  try {
    localStorage.setItem('xray_lang', lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang;
  document.body.setAttribute('data-lang', lang);

  const labels = { ru: '🇷🇺 RU', be: '🇧🇾 BE', en: '🇬🇧 EN' };
  if (els.currentLangLabel) {
    els.currentLangLabel.textContent = labels[lang] || '🇷🇺 RU';
  }

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key && i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key && i18n[lang][key]) {
      el.setAttribute('title', i18n[lang][key]);
    }
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    if (key && i18n[lang][key]) {
      el.setAttribute('aria-label', i18n[lang][key]);
    }
  });

  syncAllInputsFromState();
  if (state.pool || state.gpuExecutor) {
    updateAccelBadge();
  }
  if (els.samplesCounter) {
    els.samplesCounter.textContent = `${state.samples.length} ${t('samplesCounter')}`;
  }
  if (state.currentWidth && state.currentHeight) {
    checkResolutionWarning(state.currentWidth, state.currentHeight);
  }
  updateTelemetry(state.currentWidth, state.currentHeight);
  updateThreatPill();
  refreshCacheStats();
  if (state.currentImage) {
    renderDisplay();
  }
}

// -----------------------------------------------------------------------------
// Предупреждения разрешения и Letterbox 640×640
// -----------------------------------------------------------------------------
function checkResolutionWarning(w, h) {
  if (!els.resolutionWarning) return;
  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const aspect = minDim > 0 ? maxDim / minDim : 1;
  const warnings = [];

  if (minDim < 250) {
    warnings.push(t('warnLowRes', { w, h }));
  }
  if (maxDim > 3000) {
    warnings.push(t('warnHighRes', { w, h }));
  }
  if (aspect > 3.0) {
    warnings.push(t('warnAspect', { aspect: aspect.toFixed(1) }));
  }

  if (warnings.length > 0) {
    els.resolutionWarning.textContent = `${t('warnPrefix')}${warnings.join('; ')}.`;
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

// -----------------------------------------------------------------------------
// Карусель снимков, загрузка пользовательских фото и восстановление из IndexedDB
// -----------------------------------------------------------------------------
function buildCarousel() {
  els.samplesCarousel.innerHTML = '';
  if (els.samplesCounter) {
    els.samplesCounter.textContent = `${state.samples.length} ${t('samplesCounter')}`;
  }

  state.samples.forEach((sample, idx) => {
    const btn = document.createElement('div');
    btn.className = `sample-thumb ${sample.id === state.currentImageId ? 'is-active' : ''}`;
    btn.dataset.id = sample.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', '0');
    const displayName = getSampleDisplayName(sample);
    btn.setAttribute('aria-label', displayName);

    const imgEl = document.createElement('img');
    imgEl.alt = displayName;
    if (sample.isCustom) {
      imgEl.src = sample.path;
    } else {
      imgEl.src = sample.path;
      getCachedSampleBlobUrl(sample.path).then((cachedUrl) => {
        if (cachedUrl && imgEl.isConnected && imgEl.src !== cachedUrl) {
          imgEl.src = cachedUrl;
        }
        refreshCacheStats();
      });
    }
    btn.appendChild(imgEl);

    const tag = document.createElement('span');
    tag.className = 'sample-tag';
    tag.textContent = sample.isCustom ? 'USR' : `#${idx + 1}`;
    btn.appendChild(tag);

    const cachedResult = state.scanResults[sample.id];
    if (cachedResult) {
      const dot = document.createElement('span');
      dot.className = `sample-threat-dot ${cachedResult.boxes.length > 0 ? 'sample-threat-dot--danger' : 'sample-threat-dot--safe'}`;
      dot.title = cachedResult.boxes.length > 0
        ? `${t('threatDetected')} (${cachedResult.boxes.length})`
        : t('threatNone');
      btn.appendChild(dot);
    }

    if (sample.isCustom) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sample-btn-delete';
      delBtn.title = t('sampleDeleteAria', { name: displayName });
      delBtn.setAttribute('aria-label', t('sampleDeleteAria', { name: displayName }));
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.isScanning) deleteSample(sample.id);
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

async function deleteSample(id) {
  const target = state.samples.find(s => s.id === id);
  if (target && target.isObjectUrl) {
    URL.revokeObjectURL(target.path);
  }
  state.samples = state.samples.filter(s => s.id !== id);
  delete state.scanResults[id];
  if (target?.isCustom) {
    await deleteCustomSampleRecord(id);
    refreshCacheStats();
  }
  buildCarousel();
  if (state.currentImageId === id && state.samples.length > 0) {
    await loadSample(state.samples[0]);
  }
}

async function clearCustomSamples() {
  if (state.isScanning) return;
  const customItems = state.samples.filter(s => s.isCustom);
  customItems.forEach(item => {
    if (item.isObjectUrl) URL.revokeObjectURL(item.path);
    delete state.scanResults[item.id];
  });
  const wasCustomActive = customItems.some(s => s.id === state.currentImageId);
  state.samples = state.samples.filter(s => !s.isCustom);
  await clearCustomSamplesStore();
  buildCarousel();
  await refreshCacheStats();
  if (wasCustomActive && state.samples.length > 0) {
    await loadSample(state.samples[0]);
  }
}

async function handleCustomFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    if (els.resolutionWarning) {
      els.resolutionWarning.textContent = t('warnUnsupportedType');
      els.resolutionWarning.classList.remove('is-hidden');
    }
    return;
  }

  const customId = `custom_${Date.now()}`;
  const addedAt = Date.now();
  const objectUrl = URL.createObjectURL(file);
  const customSample = {
    id: customId,
    name: file.name,
    path: objectUrl,
    isCustom: true,
    isObjectUrl: true,
    addedAt
  };

  await saveCustomSample({ id: customId, name: file.name, blob: file, addedAt });
  state.samples.unshift(customSample);
  buildCarousel();
  await refreshCacheStats();
  // Загружаем изображение на холст без автосканирования
  await loadSample(customSample);
}

async function loadSample(sample) {
  state.currentImageId = sample.id;
  document.querySelectorAll('.sample-thumb').forEach(node => {
    node.classList.toggle('is-active', node.dataset.id === sample.id);
  });

  const resolvedUrl = sample.isCustom ? sample.path : await getCachedSampleBlobUrl(sample.path);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = resolvedUrl;
  await img.decode();

  state.currentImage = img;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  state.currentWidth = w;
  state.currentHeight = h;
  checkResolutionWarning(w, h);

  els.originalCanvas.width = w;
  els.originalCanvas.height = h;
  els.originalCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);

  els.normalizedCanvas.width = w;
  els.normalizedCanvas.height = h;
  els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);

  if (state.normalizeEnabled) {
    const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
    state.polarityInfo = basePrep.polarity;
  } else {
    state.polarityInfo = null;
  }

  const cached = state.scanResults[sample.id];
  if (cached) {
    state.boxes = cached.boxes;
    state.metrics = cached.metrics;
    state.polarityInfo = cached.polarityInfo ?? state.polarityInfo;
  } else {
    state.boxes = [];
    state.metrics = null;
  }

  const polShort = state.polarityInfo
    ? (state.polarityInfo.isInverted ? t('negativePolarity') : t('positivePolarity'))
    : t('polarityAuto');

  els.bannerTitle.textContent = t('bannerLoadedTitle', { name: getSampleDisplayName(sample) });
  els.bannerSub.textContent = cached
    ? t('bannerLoadedCached', { w, h, pol: polShort })
    : t('bannerLoadedSub', { w, h, pol: polShort });
  els.bannerMetric.textContent = cached?.metrics ? `${cached.metrics.totalMs} ms` : '— ms';

  updateTelemetry(w, h);
  updateThreatPill();
  renderDisplay();
  refreshCacheStats();
}

// -----------------------------------------------------------------------------
// Телеметрия, статус и отрисовка холста
// -----------------------------------------------------------------------------
function updateThreatPill() {
  const pill = els.threatBadge;
  const txt = els.threatText;
  if (!pill || !txt) return;

  if (state.activeView === 'original') {
    pill.className = 'detection-status is-info';
    txt.textContent = t('tabRawPill');
    return;
  }
  if (state.activeView === 'normalized') {
    pill.className = 'detection-status is-info';
    txt.textContent = t('tabNormPill');
    return;
  }

  const numBoxes = state.boxes.length;
  if (numBoxes > 0) {
    pill.className = 'detection-status is-danger';
    txt.textContent = `${t('threatDetected')} (${numBoxes})`;
  } else if (state.metrics) {
    pill.className = 'detection-status is-safe';
    txt.textContent = t('threatNone');
  } else {
    pill.className = 'detection-status';
    txt.textContent = t('threatWaiting');
  }
}

function updateTelemetry(w = state.currentWidth, h = state.currentHeight) {
  const numBoxes = state.boxes.length;
  els.threatCount.textContent = String(numBoxes);

  if (numBoxes > 0) {
    els.threatDetail.textContent = `${t('weaponDetected')}: ${numBoxes}`;
  } else if (state.metrics) {
    els.threatDetail.textContent = t('threatNone');
  } else {
    els.threatDetail.textContent = t('threatWaiting');
  }

  if (state.polarityInfo) {
    els.polarityStatus.textContent = state.polarityInfo.isInverted ? t('negativePolarity') : t('positivePolarity');
    const bg = state.polarityInfo.bgMean ?? state.polarityInfo.borderMean;
    const fg = state.polarityInfo.fgMean ?? state.polarityInfo.centerMean;
    if (bg != null && fg != null) {
      els.polarityDetail.textContent = `Bg: ${bg.toFixed(0)}, Fg: ${fg.toFixed(0)}`;
    } else {
      els.polarityDetail.textContent = state.polarityInfo.isInverted ? t('negativePolarity') : t('positivePolarity');
    }
  } else {
    els.polarityStatus.textContent = '—';
    els.polarityDetail.textContent = t('polarityAuto');
  }

  if (state.metrics) {
    els.inferTime.textContent = `${state.metrics.totalMs} ms`;
    els.inferBackend.textContent = state.metrics.provider || 'On-Device Edge';
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

function renderDisplay() {
  const canvas = els.displayCanvas;
  const ctx = canvas.getContext('2d');
  const view = state.activeView;

  let srcCanvas = els.originalCanvas;
  if (view === 'normalized') {
    srcCanvas = els.normalizedCanvas;
  } else if (view === 'detected') {
    srcCanvas = state.normalizeEnabled ? els.normalizedCanvas : els.originalCanvas;
  }

  if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) return;

  canvas.width = srcCanvas.width;
  canvas.height = srcCanvas.height;
  ctx.drawImage(srcCanvas, 0, 0);

  if (view === 'detected' && state.boxes && state.boxes.length > 0) {
    drawBoundingBoxes(ctx, canvas.width);
  }
}

function drawBoundingBoxes(ctx, imgW) {
  state.boxes.forEach(box => {
    const x = box.x1;
    const y = box.y1;
    const w = box.width ?? (box.x2 - box.x1);
    const h = box.height ?? (box.y2 - box.y1);

    ctx.save();
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = Math.max(3, Math.round(imgW / 350));
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.fillRect(x, y, w, h);

    const cornerSize = Math.max(8, Math.min(w, h) * 0.15);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, Math.round(imgW / 450));
    ctx.beginPath();
    ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y);
    ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize);
    ctx.moveTo(x, y + h - cornerSize); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerSize, y + h);
    ctx.moveTo(x + w - cornerSize, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerSize);
    ctx.stroke();

    const confPct = box.conf != null ? (box.conf * 100).toFixed(1) : '—';
    const totalSweeps = box.totalSweeps || state.extSteps;
    const hitsText = box.detectionsCount ? ` · ${box.detectionsCount}/${totalSweeps} hits` : '';
    const labelText = `⚠ ${t('weaponDetected')} ${confPct}%${hitsText}`;

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

function setScanControlsDisabled(disabled) {
  if (els.btnRunScan) els.btnRunScan.disabled = disabled;
  if (els.scanModeSelect) els.scanModeSelect.disabled = disabled;
}

function saveSessionScanResult(totalMs, provider) {
  state.metrics = { totalMs, provider };
  if (state.currentImageId) {
    state.scanResults[state.currentImageId] = {
      boxes: state.boxes,
      metrics: state.metrics,
      polarityInfo: state.polarityInfo
    };
    buildCarousel();
  }
  updateTelemetry(state.currentWidth, state.currentHeight);
  updateThreatPill();
  renderDisplay();
}

// -----------------------------------------------------------------------------
// Роутер WebGPU / WASM и калибровка
// -----------------------------------------------------------------------------
function closeGpuModal() {
  document.body.classList.remove('is-gpu-modal-open');
  if (els.gpuWorkModal && els.gpuWorkModal.open) {
    els.gpuWorkModal.close();
  }
}

function openGpuModal(totalSlices, batchSize) {
  if (!els.gpuWorkModal) return;
  if (els.gpuWorkProgressFill) els.gpuWorkProgressFill.style.width = '4%';
  if (els.gpuWorkSub) els.gpuWorkSub.textContent = t('gpuModalRun', { n: totalSlices, b: batchSize });
  if (els.gpuWorkEta) els.gpuWorkEta.textContent = t('gpuModalEtaInit');
  document.body.classList.add('is-gpu-modal-open');
  if (!els.gpuWorkModal.open) {
    els.gpuWorkModal.showModal();
  }
}

async function executeSweepsWithRouter(baseRgba, tasks, onSweepDone, { signal } = {}) {
  const gpuFrameThreshold = state.workerCount * state.gpuFramesPerCore;
  const shouldUseGpu = tasks.length > gpuFrameThreshold && state.gpuExecutor && state.gpuExecutor.isReady;

  if (shouldUseGpu) {
    const runGpuWithOverlay = async () => {
      openGpuModal(tasks.length, state.gpuExecutor.batchSize);
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
                els.gpuWorkSub.textContent = t('gpuModalBatch', { idx: batchIdx, total: totalBatches, done: doneSlices, slices: totalSlices });
              }
              if (els.gpuWorkEta) {
                els.gpuWorkEta.textContent = etaSec === null
                  ? t('gpuModalEtaInit')
                  : t('gpuModalEtaValue', { sec: etaSec.toFixed(1), ms: batchMs });
              }
            }
          }
        );
      } finally {
        closeGpuModal();
      }
    };

    try {
      const res = await runGpuWithOverlay();
      return {
        allBoxes: res.allBoxes,
        maxRawConf: res.maxRawConf,
        usedGpu: true,
        backend: `WebGPU (batch=${state.gpuExecutor.batchSize})`
      };
    } catch (gpuErr) {
      if (gpuErr.name === 'AbortError') throw gpuErr;
      console.warn('Ошибка WebGPU во время инференса, пробуем откат:', gpuErr);
      if (state.gpuExecutor.batchSize > 2) {
        try {
          state.gpuExecutor.batchSize = 2;
          await state.gpuExecutor.createSession({
            optLevel: state.gpuExecutor.optLevel,
            preferredLayout: state.gpuExecutor.preferredLayout
          });
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
            usedGpu: true,
            backend: 'WebGPU (batch=2)'
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

  await state.pool.setBaseImage(baseRgba);
  let maxRawConf = 0;
  const allBoxes = await state.pool.runParallelSweeps(
    tasks,
    null,
    (workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes, sliceMaxRaw) => {
      if (sliceMaxRaw > maxRawConf) maxRawConf = sliceMaxRaw;
      if (onSweepDone) onSweepDone(workerId, sweepIndex, k, prepMs, inferMs, totalMs, boxes, sliceMaxRaw);
    }
  );
  return {
    allBoxes,
    maxRawConf,
    usedGpu: false,
    backend: t('workersFmt', { n: state.workerCount })
  };
}

async function runDeviceCalibration() {
  if (!state.gpuExecutor) {
    state.gpuExecutor = new WebGPUExecutor(DYNAMIC_MODEL_PATH, state.modelBuffer);
  } else if (state.modelBuffer) {
    state.gpuExecutor.setModelBuffer(state.modelBuffer);
  }
  state.calibAbortController = new AbortController();

  if (els.calibModal) {
    if (els.calibProgressFill) els.calibProgressFill.style.width = '5%';
    if (els.calibModalSub) els.calibModalSub.textContent = t('calibPrepRefModal');
    if (!els.calibModal.open) els.calibModal.showModal();
  }

  try {
    let refUrl = 'samples/image9.png';
    try {
      refUrl = await getCachedSampleBlobUrl('samples/image9.png');
    } catch {
      refUrl = 'samples/image9.png';
    }

    let refInput1x = null;
    try {
      refInput1x = await loadReferenceChw(refUrl, 0.42, 640);
    } catch {
      refInput1x = null;
    }

    await state.gpuExecutor.calibrate({
      signal: state.calibAbortController.signal,
      refInput1x,
      sampleUrl: refUrl,
      t,
      onStep: (pct, msg) => {
        if (els.calibProgressFill) els.calibProgressFill.style.width = `${pct}%`;
        if (els.calibModalSub) els.calibModalSub.textContent = msg;
      }
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Accel Calibration] Калибровка прекращена пользователем. Используем WASM-пул.');
    } else {
      console.error('[Accel Calibration] Ошибка калибровки:', err);
    }
    state.gpuExecutor.isReady = false;
  } finally {
    state.calibAbortController = null;
    if (els.calibModal && els.calibModal.open) els.calibModal.close();
    updateAccelBadge();
  }
}

// -----------------------------------------------------------------------------
// Режимы сканирования: Smart, Extended, Single
// -----------------------------------------------------------------------------
async function runParallelScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  state.scanAbortController = new AbortController();
  const shouldNormalize = state.normalizeEnabled;

  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = t('extBannerTitle', { n: state.extSteps });
  els.bannerSub.textContent = t('extBannerSubPrep', { th: state.workerCount * state.gpuFramesPerCore });
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';
  els.progressLabel.textContent = t('extProgressInit');

  const tStartWall = performance.now();

  try {
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    if (shouldNormalize) {
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }

    const dstSize = 640;
    const { rgba: baseSweepRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );

    const numSteps = state.extSteps;
    const stepSize = numSteps > 1 ? 0.95 / (numSteps - 1) : 0;
    const tasks = [];
    for (let i = 0; i < numSteps; i++) {
      const k = parseFloat((i * stepSize).toFixed(3));
      tasks.push({
        sweepIndex: i,
        k,
        meta,
        dstSize,
        confThreshold: state.extConf,
        nmsIouThreshold: state.nmsIouThreshold
      });
    }

    let completedCount = 0;
    const routerRes = await executeSweepsWithRouter(
      baseSweepRgba,
      tasks,
      (_workerId, _sweepIndex, _k, _prepMs, _inferMs, totalMs) => {
        completedCount++;
        const pct = Math.round((completedCount / numSteps) * 100);
        els.progressPercent.textContent = `${pct}%`;
        els.progressFill.style.width = `${pct}%`;
        els.progressLabel.textContent = t('extProgressDone', { done: completedCount, total: numSteps });
        els.bannerSub.textContent = t('extProgressDone', { done: completedCount, total: numSteps });
        els.bannerMetric.textContent = `${totalMs} ms`;
      },
      { signal: state.scanAbortController.signal }
    );

    const fusedBoxes = fuseMultiSpectralBoxes(routerRes.allBoxes, state.extIou, state.extMinHits, numSteps);
    if (shouldNormalize) {
      state.normalizer.process(els.normalizedCanvas);
    }

    const totalWallMs = Math.round(performance.now() - tStartWall);
    state.boxes = fusedBoxes;
    saveSessionScanResult(totalWallMs, `${routerRes.backend} × ${numSteps}`);

    els.bannerTitle.textContent = t('extDoneTitle', { hits: fusedBoxes.length });
    els.bannerSub.textContent = t('extDoneSub', {
      n: numSteps,
      backend: routerRes.backend,
      sec: (totalWallMs / 1000).toFixed(2)
    });
    els.bannerMetric.textContent = `${totalWallMs} ms`;
  } catch (err) {
    if (err.name === 'AbortError') {
      els.bannerTitle.textContent = t('scanStoppedTitle');
      els.bannerSub.textContent = t('scanStoppedSub');
    } else {
      console.error('Ошибка Extended анализа:', err);
      els.bannerTitle.textContent = t('scanErrorTitle');
      els.bannerSub.textContent = err.message || String(err);
    }
  } finally {
    els.bannerSpinner.classList.remove('is-active');
    state.scanAbortController = null;
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

async function runSingleScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');
  els.bannerTitle.textContent = t('singleTitle');
  els.bannerSub.textContent = t('singleSub');

  const tStartWall = performance.now();
  const shouldNormalize = state.normalizeEnabled;

  try {
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    if (shouldNormalize) {
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }

    const dstSize = 640;
    const { rgba: baseRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );

    await state.pool.setBaseImage(baseRgba);
    const res = await state.pool.runSingleSweep({
      sweepIndex: 0,
      k: state.normalizer.kSat,
      meta,
      dstSize,
      confThreshold: state.singleConf,
      nmsIouThreshold: state.nmsIouThreshold
    });

    if (shouldNormalize) {
      state.normalizer.process(els.normalizedCanvas);
    }

    const totalWallMs = Math.round(performance.now() - tStartWall);
    state.boxes = res.boxes;
    saveSessionScanResult(totalWallMs, `${t('workersShortFmt', { n: 1 })} · 1`);

    els.progressPercent.textContent = '100%';
    els.progressFill.style.width = '100%';
    els.progressLabel.textContent = t('singleDoneProgress');
    els.bannerTitle.textContent = t('singleDoneTitle', { hits: res.boxes.length });
    els.bannerSub.textContent = t('singleDoneSub', {
      k: state.normalizer.kSat.toFixed(2),
      infer: res.inferMs,
      total: totalWallMs
    });
    els.bannerMetric.textContent = `${totalWallMs} ms`;
  } catch (err) {
    console.error('Ошибка одиночного скана:', err);
    els.bannerTitle.textContent = t('singleErrorTitle');
    els.bannerSub.textContent = err.message || String(err);
  } finally {
    els.bannerSpinner.classList.remove('is-active');
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

async function runSmartScan() {
  if (state.isScanning || !state.currentImage || !state.pool) return;
  state.isScanning = true;
  state.scanAbortController = new AbortController();
  const shouldNormalize = state.normalizeEnabled;

  setScanControlsDisabled(true);
  els.bannerSpinner.classList.add('is-active');

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
  if (!stage1K.some(v => Math.abs(v) < 1e-4)) {
    stage1K.unshift(0);
  }

  els.bannerTitle.textContent = t('smartStage1Title', { n: stage1K.length });
  els.bannerSub.textContent = t('smartStage1Sub', {
    a: state.gridMargin.toFixed(2),
    b: (1 - state.gridMargin).toFixed(2),
    step: state.gridStep.toFixed(2),
    total: fullGrid.length
  });
  els.progressPercent.textContent = '0%';
  els.progressFill.style.width = '0%';
  els.progressLabel.textContent = t('smartStage1Prog', { done: 0, total: stage1K.length });

  const tStartWall = performance.now();

  try {
    els.normalizedCanvas.getContext('2d', { willReadFrequently: true }).drawImage(els.originalCanvas, 0, 0);
    if (shouldNormalize) {
      const basePrep = state.normalizer.prepareBase(els.normalizedCanvas);
      state.polarityInfo = basePrep.polarity;
    } else {
      state.polarityInfo = null;
    }

    const dstSize = 640;
    const { rgba: baseSweepRgba, meta } = prepareLetterboxRgba(
      shouldNormalize ? els.normalizedCanvas : els.originalCanvas,
      dstSize
    );

    const stage1Tasks = stage1K.map((k, idx) => ({
      sweepIndex: idx,
      k,
      meta,
      dstSize,
      confThreshold: state.extConf,
      nmsIouThreshold: state.nmsIouThreshold
    }));

    let completed = 0;
    const hitKs = [];

    const res1 = await executeSweepsWithRouter(
      baseSweepRgba,
      stage1Tasks,
      (_workerId, _sweepIndex, k, _prepMs, _inferMs, totalMs, boxes, sliceMaxRaw = 0) => {
        completed++;
        const isWhisper = state.smartWhisperConf > 0 && sliceMaxRaw >= state.smartWhisperConf;
        if (boxes.length > 0 || isWhisper) hitKs.push(k);

        const pct = Math.round((completed / stage1Tasks.length) * 50);
        els.progressPercent.textContent = `${pct}%`;
        els.progressFill.style.width = `${pct}%`;
        els.progressLabel.textContent = t('smartStage1Prog', { done: completed, total: stage1Tasks.length });
        els.bannerMetric.textContent = `${totalMs} ms`;
      },
      { signal: state.scanAbortController.signal }
    );

    const allBoxes = [...res1.allBoxes];
    const usedKSet = new Set(stage1K.map(v => v.toFixed(3)));
    let stage2K = [];
    let stage2Reason = '';

    if (hitKs.length > 0) {
      stage2Reason = t('smartStage2Found', { hits: hitKs.length, total: stage1K.length });
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
      stage2Reason = t('smartStage2Empty', { total: stage1K.length });
      stage2K = fullGrid.filter(k => !usedKSet.has(k.toFixed(3)));
    }

    let res2Backend = null;
    if (stage2K.length > 0) {
      els.bannerTitle.textContent = t('smartStage2Title', { n: stage2K.length });
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
        (_workerId, _sweepIndex, _k, _prepMs, _inferMs, totalMs) => {
          completed2++;
          const pct = 50 + Math.round((completed2 / stage2Tasks.length) * 50);
          els.progressPercent.textContent = `${pct}%`;
          els.progressFill.style.width = `${pct}%`;
          els.progressLabel.textContent = t('smartStage2Prog', { done: completed2, total: stage2Tasks.length });
          els.bannerMetric.textContent = `${totalMs} ms`;
        },
        { signal: state.scanAbortController.signal }
      );
      res2Backend = res2.backend;
      res2.allBoxes.forEach(b => allBoxes.push(b));
    }

    const backendLabel = res2Backend && res2Backend !== res1.backend
      ? `${res1.backend} + ${res2Backend}`
      : res1.backend;
    const totalEvaluated = stage1K.length + stage2K.length;
    const fusedBoxes = fuseMultiSpectralBoxes(allBoxes, state.extIou, state.extMinHits, totalEvaluated);

    if (shouldNormalize) {
      state.normalizer.process(els.normalizedCanvas);
    }

    const totalWallMs = Math.round(performance.now() - tStartWall);
    state.boxes = fusedBoxes;
    saveSessionScanResult(totalWallMs, `${backendLabel} · Smart`);

    els.progressPercent.textContent = '100%';
    els.progressFill.style.width = '100%';
    els.progressLabel.textContent = t('smartDoneProg', { s1: stage1K.length, s2: stage2K.length, total: totalEvaluated });
    els.bannerTitle.textContent = t('smartDoneTitle', { hits: fusedBoxes.length, s1: stage1K.length, s2: stage2K.length });
    els.bannerSub.textContent = t('smartDoneSub', {
      reason: stage2Reason,
      backend: backendLabel,
      sec: (totalWallMs / 1000).toFixed(2)
    });
    els.bannerMetric.textContent = `${totalWallMs} ms`;
  } catch (err) {
    if (err.name === 'AbortError') {
      els.bannerTitle.textContent = t('smartStoppedTitle');
      els.bannerSub.textContent = t('smartStoppedSub');
    } else {
      console.error('Ошибка Smart-сканирования:', err);
      els.bannerTitle.textContent = t('smartErrorTitle');
      els.bannerSub.textContent = err.message || String(err);
    }
  } finally {
    els.bannerSpinner.classList.remove('is-active');
    state.scanAbortController = null;
    state.isScanning = false;
    setScanControlsDisabled(false);
  }
}

// -----------------------------------------------------------------------------
// Пресеты, настройки и меню очистки кэша (с прогрессивным улучшением Popover/Focusgroup)
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
  syncAllInputsFromState();
  saveSettings();
}

function resetSettingsToDefaults() {
  Object.assign(state, {
    scanMode: DEFAULT_SETTINGS.scanMode,
    extPreset: DEFAULT_SETTINGS.extPreset,
    extConf: DEFAULT_SETTINGS.extConf,
    extSteps: DEFAULT_SETTINGS.extSteps,
    extMinHits: DEFAULT_SETTINGS.extMinHits,
    extIou: DEFAULT_SETTINGS.extIou,
    gridMargin: DEFAULT_SETTINGS.gridMargin,
    gridStep: DEFAULT_SETTINGS.gridStep,
    singleConf: DEFAULT_SETTINGS.singleConf,
    normalizeEnabled: DEFAULT_SETTINGS.normalize,
    imageSmoothingQuality: DEFAULT_SETTINGS.imageSmoothingQuality,
    nmsIouThreshold: DEFAULT_SETTINGS.nmsIouThreshold,
    smartMaxStage1: DEFAULT_SETTINGS.smartMaxStage1,
    smartWhisperConf: DEFAULT_SETTINGS.smartWhisperConf,
    gpuFramesPerCore: DEFAULT_SETTINGS.gpuFramesPerCore
  });
  state.normalizer.kSat = DEFAULT_SETTINGS.kSat;
  state.normalizer.targetWhite = DEFAULT_SETTINGS.targetWhite;
  state.normalizer.distThresh = DEFAULT_SETTINGS.distThresh;
  syncAllInputsFromState();
  if (state.currentImage && state.normalizeEnabled) {
    els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
    state.normalizer.process(els.normalizedCanvas);
    renderDisplay();
  }
}

async function handleCacheAction(action) {
  if (action === 'all') {
    if (!window.confirm(t('cacheConfirmAll'))) return;
    await clearAllPersistentCaches({ clearPrefs: true });
    window.location.reload();
    return;
  }

  if (action === 'model') {
    await clearModelCache();
  } else if (action === 'samples') {
    await clearSamplesCache();
  } else if (action === 'custom') {
    await clearCustomSamples();
  } else if (action === 'prefs') {
    WebGPUExecutor.clearSavedProfile();
    try {
      localStorage.removeItem(PREF_STORAGE_KEYS.settings);
    } catch {
      // ignore
    }
    if (state.gpuExecutor) state.gpuExecutor.isReady = false;
    resetSettingsToDefaults();
    updateAccelBadge();
  }

  await refreshCacheStats();
  if (els.bannerSub && !state.isScanning) {
    els.bannerSub.textContent = t('cacheClearedMsg');
  }
}

function setupCacheSplitMenu() {
  const trigger = els.btnCacheMenuToggle;
  const menu = els.cacheClearMenu;
  if (!trigger || !menu) return;

  const hasPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
  const hasInvoker = 'commandForElement' in HTMLButtonElement.prototype;
  const hasAnchorPos = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('position-area', 'block-end');
  const hasFocusGroup = 'focusGroup' in HTMLElement.prototype;

  const isMenuOpen = () => hasPopover ? menu.matches(':popover-open') : menu.classList.contains(':popover-open');

  const positionMenuFallback = () => {
    const trRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = trRect.right - menuRect.width;
    if (left < pad) left = pad;
    if (left + menuRect.width > vw - pad) left = Math.max(pad, vw - menuRect.width - pad);
    let top = trRect.bottom + 6;
    if (top + menuRect.height > vh - pad && trRect.top - menuRect.height - 6 >= pad) {
      top = trRect.top - menuRect.height - 6;
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const openMenu = () => {
    if (hasPopover) menu.showPopover({ source: trigger });
    else {
      menu.classList.add(':popover-open');
      trigger.setAttribute('aria-expanded', 'true');
      positionMenuFallback();
    }
  };

  const closeMenu = ({ restoreFocus = true, fromPointer = false } = {}) => {
    if (restoreFocus) {
      trigger.focus({ focusVisible: !fromPointer });
    }
    if (hasPopover) {
      if (menu.matches(':popover-open')) menu.hidePopover();
    } else {
      menu.classList.remove(':popover-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  };

  let pointerTriggered = false;
  trigger.addEventListener('pointerdown', (e) => {
    pointerTriggered = true;
    e.preventDefault();
  });

  if (!hasInvoker || !hasPopover) {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (isMenuOpen()) closeMenu({ restoreFocus: false });
      else openMenu();
    });
  }

  menu.addEventListener('toggle', (e) => {
    const open = e.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (open && !hasAnchorPos) {
      positionMenuFallback();
    }
    if (open && !pointerTriggered) {
      const firstItem = menu.querySelector('.cache-menu-item');
      firstItem?.focus();
    }
    pointerTriggered = false;
  });

  if (!hasFocusGroup) {
    const group = menu.querySelector('[focusgroup]');
    if (group) {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button').forEach(b => b.setAttribute('role', 'menuitem'));
      group.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(e.key)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu({ restoreFocus: true, fromPointer: false });
          return;
        }
        const items = [...group.querySelectorAll('button:not(:disabled)')];
        if (!items.length) return;
        const cur = items.indexOf(document.activeElement);
        let next = 0;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else next = (cur + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        e.preventDefault();
        items[next].focus({ preventScroll: true });
      });
    }
  }

  menu.querySelectorAll('.cache-menu-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const fromPointer = e.detail !== 0;
      const action = btn.dataset.cacheAction;
      closeMenu({ restoreFocus: true, fromPointer });
      if (action) await handleCacheAction(action);
    });
  });

  if (els.btnClearCacheAll) {
    els.btnClearCacheAll.addEventListener('click', () => handleCacheAction('all'));
  }
}

// -----------------------------------------------------------------------------
// Привязка всех событий UI
// -----------------------------------------------------------------------------
function bindEvents() {
  // Языковой дропдаун
  if (els.langBtn && els.langMenu) {
    const toggleLangMenu = (open) => {
      const next = open !== undefined ? open : !els.langMenu.classList.contains('show');
      els.langMenu.classList.toggle('show', next);
      els.langBtn.setAttribute('aria-expanded', String(next));
    };

    els.langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLangMenu();
    });

    document.querySelectorAll('.lang-option').forEach(btn => {
      btn.addEventListener('click', () => {
        setLanguage(btn.dataset.lang);
        toggleLangMenu(false);
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.lang-dropdown')) {
        toggleLangMenu(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.langMenu.classList.contains('show')) {
        toggleLangMenu(false);
        els.langBtn.focus();
      }
    });
  }

  // Тема
  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', cycleTheme);
  }

  // Очистка добавленных снимков
  if (els.btnClearCustom) {
    els.btnClearCustom.addEventListener('click', () => {
      clearCustomSamples();
    });
  }

  // Вкладки слоев изображения
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
      updateThreatPill();
      renderDisplay();
    });
  });

  // Запуск сканирования по выбранному режиму
  if (els.scanModeSelect) {
    els.scanModeSelect.addEventListener('change', (e) => {
      state.scanMode = e.target.value;
      saveSettings();
    });
  }

  if (els.btnRunScan) {
    els.btnRunScan.addEventListener('click', () => {
      const mode = els.scanModeSelect ? els.scanModeSelect.value : 'smart';
      if (mode === 'extended') runParallelScan();
      else if (mode === 'single') runSingleScan();
      else runSmartScan();
    });
  }

  // Dropzone (click + drag & drop)
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

  // Настройки ALGO ACCEL
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

  if (els.gridMarginRange) {
    els.gridMarginRange.addEventListener('input', (e) => {
      state.gridMargin = parseFloat(e.target.value);
      if (els.gridMarginVal) els.gridMarginVal.textContent = state.gridMargin.toFixed(2);
      updateGridStepLabel();
      saveSettings();
    });
  }

  if (els.gridStepRange) {
    els.gridStepRange.addEventListener('input', (e) => {
      state.gridStep = parseFloat(e.target.value);
      updateGridStepLabel();
      saveSettings();
    });
  }

  // Настройки EXTENDED & SMART
  if (els.extPresetSelect) {
    els.extPresetSelect.addEventListener('change', (e) => applyPreset(e.target.value));
  }
  if (els.extConfRange) {
    els.extConfRange.addEventListener('input', (e) => {
      state.extConf = parseFloat(e.target.value);
      els.extConfVal.textContent = state.extConf.toFixed(2);
      state.extPreset = 'custom';
      if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
      saveSettings();
    });
  }
  if (els.extStepRange) {
    els.extStepRange.addEventListener('input', (e) => {
      state.extSteps = parseInt(e.target.value, 10);
      els.extStepVal.textContent = `${state.extSteps} ${t('stepsUnit')}`;
      state.extPreset = 'custom';
      if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
      updateRunButtonText();
      saveSettings();
    });
  }
  if (els.extIouRange) {
    els.extIouRange.addEventListener('input', (e) => {
      state.extIou = parseFloat(e.target.value);
      els.extIouVal.textContent = state.extIou.toFixed(2);
      state.extPreset = 'custom';
      if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
      saveSettings();
    });
  }
  if (els.extMinHitsRange) {
    els.extMinHitsRange.addEventListener('input', (e) => {
      state.extMinHits = parseInt(e.target.value, 10);
      els.extMinHitsVal.textContent = `${state.extMinHits} ${t('spectraUnit')}`;
      state.extPreset = 'custom';
      if (els.extPresetSelect) els.extPresetSelect.value = 'custom';
      saveSettings();
    });
  }

  // Настройки SINGLE
  if (els.confRange) {
    els.confRange.addEventListener('input', (e) => {
      state.singleConf = parseFloat(e.target.value);
      els.confVal.textContent = state.singleConf.toFixed(2);
      saveSettings();
    });
  }
  if (els.satRange) {
    els.satRange.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      els.satVal.textContent = val.toFixed(2);
      state.normalizer.kSat = val;
      saveSettings();
      if (state.currentImage && state.normalizeEnabled) {
        els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
        state.normalizer.process(els.normalizedCanvas);
        renderDisplay();
      }
    });
  }
  if (els.whiteRange) {
    els.whiteRange.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      els.whiteVal.textContent = String(val);
      state.normalizer.targetWhite = val;
      saveSettings();
      if (state.currentImage && state.normalizeEnabled) {
        els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
        state.normalizer.process(els.normalizedCanvas);
        renderDisplay();
      }
    });
  }
  if (els.normalizeToggle) {
    els.normalizeToggle.addEventListener('change', () => {
      state.normalizeEnabled = els.normalizeToggle.checked;
      saveSettings();
      if (state.currentImage) {
        els.normalizedCanvas.getContext('2d').drawImage(els.originalCanvas, 0, 0);
        if (state.normalizeEnabled) {
          state.normalizer.process(els.normalizedCanvas);
        }
        renderDisplay();
      }
    });
  }

  // Настройки RESEARCH LAB
  if (els.smoothingSelect) {
    els.smoothingSelect.addEventListener('change', (e) => {
      state.imageSmoothingQuality = e.target.value;
      saveSettings();
    });
  }
  if (els.nmsIouRange) {
    els.nmsIouRange.addEventListener('input', (e) => {
      state.nmsIouThreshold = parseFloat(e.target.value);
      if (els.nmsIouVal) els.nmsIouVal.textContent = state.nmsIouThreshold.toFixed(2);
      saveSettings();
    });
  }
  if (els.smartStage1Range) {
    els.smartStage1Range.addEventListener('input', (e) => {
      state.smartMaxStage1 = parseInt(e.target.value, 10);
      if (els.smartStage1Val) els.smartStage1Val.textContent = String(state.smartMaxStage1);
      saveSettings();
    });
  }
  if (els.smartWhisperRange) {
    els.smartWhisperRange.addEventListener('input', (e) => {
      state.smartWhisperConf = parseFloat(e.target.value);
      if (els.smartWhisperVal) els.smartWhisperVal.textContent = state.smartWhisperConf.toFixed(2);
      saveSettings();
    });
  }
  if (els.distThreshRange) {
    els.distThreshRange.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      state.normalizer.distThresh = v;
      if (els.distThreshVal) els.distThreshVal.textContent = String(v);
      saveSettings();
      if (state.currentImage && state.normalizeEnabled) {
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
      saveSettings();
    });
  }

  // Модальные окна и защита от Esc там, где closedby="none" не поддерживается (Safari)
  if (els.btnCancelCalib) {
    els.btnCancelCalib.addEventListener('click', () => {
      state.calibAbortController?.abort();
      if (els.calibModal?.open) els.calibModal.close();
    });
  }
  if (els.calibModal) {
    els.calibModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      state.calibAbortController?.abort();
      if (els.calibModal.open) els.calibModal.close();
    });
  }

  if (els.btnCancelGpuWork) {
    els.btnCancelGpuWork.addEventListener('click', () => {
      state.scanAbortController?.abort();
      closeGpuModal();
    });
  }
  if (els.gpuWorkModal) {
    els.gpuWorkModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      state.scanAbortController?.abort();
      closeGpuModal();
    });
  }

  setupCacheSplitMenu();
}

// -----------------------------------------------------------------------------
// Главная точка входа (БЕЗ автоскана при загрузке!)
// -----------------------------------------------------------------------------
async function init() {
  setTheme(currentTheme);
  setLanguage(currentLang);
  bindEvents();

  try {
    const savedCustom = await listCustomSamples();
    if (savedCustom.length > 0) {
      const restored = savedCustom.map(rec => ({
        id: rec.id,
        name: rec.name,
        path: URL.createObjectURL(rec.blob),
        isCustom: true,
        isObjectUrl: true,
        addedAt: rec.addedAt
      }));
      state.samples = [...restored, ...BUILTIN_SAMPLES];
    }
  } catch (err) {
    console.warn('Не удалось восстановить загруженные фото из IndexedDB:', err);
  }

  buildCarousel();
  if (state.samples.length > 0) {
    loadSample(state.samples[0]).catch(err => console.warn('Ошибка первичной загрузки сэмпла:', err));
  }

  try {
    els.hardwareStatus.textContent = t('hardwareStartingPool', { n: state.workerCount });
    els.statusDot.classList.add('status-dot--loading');

    const { buffer } = await getCachedModelBuffer(DYNAMIC_MODEL_PATH);
    state.modelBuffer = buffer;
    refreshCacheStats();

    state.pool = new ParallelWorkerPool(state.workerCount, DYNAMIC_MODEL_PATH, state.modelBuffer);
    await state.pool.init((ready, total) => {
      els.hardwareStatus.textContent = t('hardwareWorkersProgress', { ready, total });
    });

    state.gpuExecutor = new WebGPUExecutor(DYNAMIC_MODEL_PATH, state.modelBuffer);
    const savedProfile = WebGPUExecutor.getSavedProfile();
    if (!savedProfile) {
      await runDeviceCalibration();
    } else if (savedProfile.backend === 'webgpu') {
      els.hardwareStatus.textContent = t('hardwareRestoringGpu');
      await state.gpuExecutor.initFromProfile(savedProfile);
    }

    updateAccelBadge();
    els.statusDot.classList.remove('status-dot--loading');
    els.bannerTitle.textContent = t('bannerReadyTitle', {
      profile: els.accelProfileVal ? els.accelProfileVal.textContent : 'OK'
    });
    els.bannerSub.textContent = t('bannerReadySub');
  } catch (err) {
    console.error('Ошибка инициализации пула воркеров:', err);
    els.hardwareStatus.textContent = t('hardwareWorkerError');
    els.statusDot.style.background = 'var(--danger)';
    els.statusDot.classList.remove('status-dot--loading');
    els.bannerTitle.textContent = t('bannerInitError');
    els.bannerSub.textContent = err.message || String(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
