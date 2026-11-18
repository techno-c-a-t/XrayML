/**
 * yolo-detector.js
 * Клиентский инференс YOLO11 nano через ONNX Runtime Web (WebGPU / WASM).
 * 
 * Вход: Canvas (нормализованный рентген)
 * Пайплайн: Letterbox (640x640) -> CHW Float32 [0..1] -> ONNX Runtime -> NMS -> Отрисовка боксов
 */

export class YoloDetector {
  constructor(options = {}) {
    this.modelPath = options.modelPath || '/models/best.onnx';
    this.confThreshold = options.confThreshold || 0.35;
    this.iouThreshold = options.iouThreshold || 0.45;
    this.inputSize = 640;
    this.session = null;
    this.classNames = ['Gun']; // Класс модели gun_fine_with_negatives-3
    this.executionProvider = 'wasm';
  }

  /**
   * Загрузка модели через ONNX Runtime Web
   * По умолчанию используется WASM SIMD для гарантированной идентичности и точности детекций
   * на всех устройствах (десктоп, Android, iOS).
   */
  async loadModel(onProgress, forceProvider = 'wasm') {
    if (!window.ort) {
      throw new Error('ONNX Runtime Web (ort) не загружен. Проверьте подключение скрипта.');
    }

    if (onProgress) onProgress({ status: 'loading', message: 'Инициализация нейросети...' });

    // Настройка многопоточности WASM (использование доступных ядер CPU)
    const numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
    if (window.ort.env && window.ort.env.wasm) {
      window.ort.env.wasm.numThreads = numThreads;
      window.ort.env.wasm.simd = true;
    }

    // Если явно запрошен WebGPU
    if (forceProvider === 'webgpu' && navigator.gpu) {
      try {
        console.log('Попытка запуска через WebGPU...');
        this.session = await window.ort.InferenceSession.create(this.modelPath, {
          executionProviders: ['webgpu', 'wasm']
        });
        this.executionProvider = 'webgpu';
        if (onProgress) onProgress({ status: 'ready', provider: 'webgpu' });
        return this.session;
      } catch (err) {
        console.warn('WebGPU не смог создать сессию модели, переключаемся на WASM SIMD:', err);
      }
    }

    // Основной и эталонный провайдер: WASM SIMD (работает детерминированно на ПК и телефонах)
    console.log(`Запуск сессии через WASM SIMD (${numThreads} потоков)...`);
    const wasmOptions = {
      executionProviders: ['wasm']
    };
    if (window.crossOriginIsolated) {
      wasmOptions.executionMode = 'parallel';
      wasmOptions.intraOpNumThreads = numThreads;
      wasmOptions.interOpNumThreads = numThreads;
    }

    this.session = await window.ort.InferenceSession.create(this.modelPath, wasmOptions);
    this.executionProvider = 'wasm';
    if (onProgress) onProgress({ status: 'ready', provider: 'wasm' });
    return this.session;
  }

  /**
   * Подготовка входного тензора [1, 3, 640, 640] с сохранением пропорций (Letterbox)
   */
  preprocess(canvas) {
    const srcW = canvas.width;
    const srcH = canvas.height;
    const dstSize = this.inputSize;

    // Вычисляем масштаб с сохранением соотношения сторон
    const scale = Math.min(dstSize / srcW, dstSize / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);
    const padX = (dstSize - newW) / 2;
    const padY = (dstSize - newH) / 2;

    // Переиспользуемый offscreen canvas для letterbox
    if (!this._offCanvas) {
      this._offCanvas = document.createElement('canvas');
      this._offCanvas.width = dstSize;
      this._offCanvas.height = dstSize;
      this._offCtx = this._offCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this._offCtx;

    // Серый фон для паддинга
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, dstSize, dstSize);
    ctx.drawImage(canvas, 0, 0, srcW, srcH, padX, padY, newW, newH);

    const imgData = ctx.getImageData(0, 0, dstSize, dstSize);
    const pixels = imgData.data;

    // Переиспользуемый буфер Float32Array для исключения GC-пауз
    const area = dstSize * dstSize;
    if (!this._floatArr || this._floatArr.length !== 3 * area) {
      this._floatArr = new Float32Array(3 * area);
    }
    const floatArr = this._floatArr;
    const inv255 = 1.0 / 255.0;

    for (let i = 0; i < area; i++) {
      const pIdx = i * 4;
      floatArr[i] = pixels[pIdx] * inv255;
      floatArr[area + i] = pixels[pIdx + 1] * inv255;
      floatArr[area * 2 + i] = pixels[pIdx + 2] * inv255;
    }

    const tensor = new window.ort.Tensor('float32', floatArr, [1, 3, dstSize, dstSize]);

    return {
      tensor,
      meta: { srcW, srcH, scale, padX, padY }
    };
  }

  /**
   * Быстрый инференс напрямую из подготовленного Float32 тензора
   */
  async detectTensor(tensor, meta, customConf = null) {
    if (!this.session) {
      throw new Error('Модель еще не загружена.');
    }

    const confThreshold = customConf !== null ? customConf : this.confThreshold;
    const inputName = this.session.inputNames[0];
    const feeds = {};
    feeds[inputName] = tensor;

    const tInferStart = performance.now();
    const results = await this.session.run(feeds);
    const tInfer = performance.now() - tInferStart;

    const outputName = this.session.outputNames[0];
    const outputTensor = results[outputName];
    const data = typeof outputTensor.getData === 'function'
      ? await outputTensor.getData()
      : outputTensor.data;
    const [batch, channels, numBoxes] = outputTensor.dims;

    const rawBoxes = [];
    for (let i = 0; i < numBoxes; i++) {
      const conf = data[4 * numBoxes + i];
      if (conf >= confThreshold) {
        const cx = data[0 * numBoxes + i];
        const cy = data[1 * numBoxes + i];
        const w = data[2 * numBoxes + i];
        const h = data[3 * numBoxes + i];

        const origX1 = Math.max(0, (cx - w / 2 - meta.padX) / meta.scale);
        const origY1 = Math.max(0, (cy - h / 2 - meta.padY) / meta.scale);
        const origX2 = Math.min(meta.srcW, (cx + w / 2 - meta.padX) / meta.scale);
        const origY2 = Math.min(meta.srcH, (cy + h / 2 - meta.padY) / meta.scale);

        rawBoxes.push({
          x1: origX1,
          y1: origY1,
          x2: origX2,
          y2: origY2,
          width: origX2 - origX1,
          height: origY2 - origY1,
          conf,
          classId: 0,
          label: this.classNames[0] || 'Threat'
        });
      }
    }

    const finalBoxes = this.applyNMS(rawBoxes, this.iouThreshold);
    return {
      boxes: finalBoxes,
      metrics: {
        inferenceMs: Math.round(tInfer),
        provider: this.executionProvider
      }
    };
  }

  /**
   * Инференс и постпроцессинг (NMS)
   * @param {HTMLCanvasElement} canvas
   * @param {number|null} customConf - кастомный порог уверенности (например, 0.15 для параноидального режима)
   */
  async detect(canvas, customConf = null) {
    if (!this.session) {
      throw new Error('Модель еще не загружена.');
    }

    const confThreshold = customConf !== null ? customConf : this.confThreshold;
    const tStart = performance.now();
    const { tensor, meta } = this.preprocess(canvas);
    const tPre = performance.now();

    // Запуск сети
    const inputName = this.session.inputNames[0];
    const feeds = {};
    feeds[inputName] = tensor;
    const results = await this.session.run(feeds);
    const tInfer = performance.now();

    // Выходная форма YOLO11: [1, 4 + num_classes, 8400]
    const outputName = this.session.outputNames[0];
    const outputTensor = results[outputName];
    // Для WebGPU данные находятся в буфере GPU и требуют асинхронной загрузки через getData()
    const data = typeof outputTensor.getData === 'function'
      ? await outputTensor.getData()
      : outputTensor.data;
    const [batch, channels, numBoxes] = outputTensor.dims; // [1, 5, 8400]

    // Парсим боксы
    const rawBoxes = [];
    for (let i = 0; i < numBoxes; i++) {
      // Каналы: 0: cx, 1: cy, 2: w, 3: h, 4: conf (Gun)
      const conf = data[4 * numBoxes + i];
      if (conf >= confThreshold) {
        const cx = data[0 * numBoxes + i];
        const cy = data[1 * numBoxes + i];
        const w = data[2 * numBoxes + i];
        const h = data[3 * numBoxes + i];

        // Преобразуем из координат letterbox (640x640) в координаты исходной картинки
        const origX1 = Math.max(0, (cx - w / 2 - meta.padX) / meta.scale);
        const origY1 = Math.max(0, (cy - h / 2 - meta.padY) / meta.scale);
        const origX2 = Math.min(meta.srcW, (cx + w / 2 - meta.padX) / meta.scale);
        const origY2 = Math.min(meta.srcH, (cy + h / 2 - meta.padY) / meta.scale);

        rawBoxes.push({
          x1: origX1,
          y1: origY1,
          x2: origX2,
          y2: origY2,
          width: origX2 - origX1,
          height: origY2 - origY1,
          conf,
          classId: 0,
          label: this.classNames[0] || 'Threat'
        });
      }
    }

    // Применяем Non-Maximum Suppression (NMS)
    const finalBoxes = this.applyNMS(rawBoxes, this.iouThreshold);
    const tPost = performance.now();

    return {
      boxes: finalBoxes,
      metrics: {
        preprocessMs: Math.round(tPre - tStart),
        inferenceMs: Math.round(tInfer - tPre),
        postprocessMs: Math.round(tPost - tInfer),
        totalMs: Math.round(tPost - tStart),
        provider: this.executionProvider
      }
    };
  }

  applyNMS(boxes, iouThreshold) {
    if (boxes.length === 0) return [];

    // Сортируем по убыванию уверенности
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
        if (this.calculateIoU(bA, bB) > iouThreshold) {
          active[j] = false;
        }
      }
    }

    return selected;
  }

  /**
   * Слияние ансамбля предсказаний (Weighted Box Fusion / Soft-NMS) от мультиспектрального прогона
   * @param {Array} boxes - массив всех обнаруженных рамок
   * @param {number} iouThreshold - порог слияния пересечений
   * @param {number} minDetections - минимальное число подтверждений (1 = параноидальный режим: сохранять даже одиночные детекции)
   */
  mergeMultiSpectralBoxes(boxes, iouThreshold = 0.5, minDetections = 1) {
    if (boxes.length === 0) return [];

    // Группируем перекрывающиеся боксы в кластеры
    const clusters = [];
    const used = new Array(boxes.length).fill(false);

    for (let i = 0; i < boxes.length; i++) {
      if (used[i]) continue;
      const cluster = [boxes[i]];
      used[i] = true;

      for (let j = i + 1; j < boxes.length; j++) {
        if (used[j]) continue;
        if (this.calculateIoU(boxes[i], boxes[j]) > iouThreshold) {
          cluster.push(boxes[j]);
          used[j] = true;
        }
      }
      clusters.push(cluster);
    }

    // Фильтруем кластеры по минимальному порогу подтверждений (позволяет отсекать шум или включать параноидальный режим)
    const validClusters = clusters.filter(c => c.length >= minDetections);

    // Для каждого кластера усредняем координаты с весом уверенности (WBF)
    const fusedBoxes = validClusters.map(cluster => {
      let sumConf = 0;
      let sumX1 = 0, sumY1 = 0, sumX2 = 0, sumY2 = 0;
      let maxConf = 0;
      let bestKSat = cluster[0].kSat;

      cluster.forEach(b => {
        const w = b.conf;
        sumConf += w;
        sumX1 += b.x1 * w;
        sumY1 += b.y1 * w;
        sumX2 += b.x2 * w;
        sumY2 += b.y2 * w;
        if (b.conf > maxConf) {
          maxConf = b.conf;
          bestKSat = b.kSat;
        }
      });

      const avgX1 = sumX1 / sumConf;
      const avgY1 = sumY1 / sumConf;
      const avgX2 = sumX2 / sumConf;
      const avgY2 = sumY2 / sumConf;

      return {
        x1: avgX1,
        y1: avgY1,
        x2: avgX2,
        y2: avgY2,
        width: avgX2 - avgX1,
        height: avgY2 - avgY1,
        conf: maxConf,
        classId: cluster[0].classId,
        label: cluster[0].label,
        detectionsCount: cluster.length, // Сколько раз был замечен на разных k_sat
        bestKSat
      };
    });

    return fusedBoxes;
  }

  calculateIoU(boxA, boxB) {
    const xA = Math.max(boxA.x1, boxB.x1);
    const yA = Math.max(boxA.y1, boxB.y1);
    const xB = Math.min(boxA.x2, boxB.x2);
    const yB = Math.min(boxA.y2, boxB.y2);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (interArea === 0) return 0;

    const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
    const areaB = (boxB.x2 - boxB.x1) * (boxB.y2 - boxB.y1);
    const unionArea = areaA + areaB - interArea;

    return interArea / unionArea;
  }
}
