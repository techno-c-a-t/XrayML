/**
 * xray-normalizer.js
 * Точный перенос пайплайна из src/data/normalize.py на клиентский JavaScript Canvas API.
 * 
 * Шаг 1: Проверка полярности двумя методами + арбитраж (инверсия негатива).
 * Шаг 2: Нейтрализация фона рамки (превращение цветного шума/воздуха в нейтральный фон).
 * Шаг 3: Выравнивание точки белого (White Balance).
 * Шаг 4: Десатурация/сжатие разлета каналов к среднему (гашение ядовитых цветов).
 */

export class XrayNormalizer {
  constructor(options = {}) {
    this.targetWhite = options.targetWhite || 248;
    this.kSat = options.kSat !== undefined ? options.kSat : 0.42;
    this.distThresh = options.distThresh || 55;
  }

  /**
   * Подготавливает базовый нормализованный снимок (Шаги 1-3: полярность, рамка, баланс белого),
   * чтобы затем можно было сверхбыстро менять только kSat без повторения тяжелых шагов.
   */
  prepareBase(sourceCanvas) {
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Шаг 1: Полярность
    const polarityResult = this.detectPolarity(data, width, height);
    if (polarityResult.isInverted) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
    }

    // Шаг 2: Нейтрализация рамки
    this.neutralizeBackground(data, width, height, 0.03, this.distThresh, [245, 245, 245]);

    // Шаг 3: Точка белого
    this.alignWhitePoint(data, this.targetWhite);

    // Записываем нормализованную базу обратно в холст
    ctx.putImageData(imgData, 0, 0);

    return {
      baseImageData: imgData,
      polarity: polarityResult,
      width,
      height
    };
  }

  /**
   * Полный цикл для одиночного режима: prepareBase + applySaturationOnly
   */
  process(sourceCanvas, customKSat = null) {
    const k = customKSat !== null ? customKSat : this.kSat;
    const base = this.prepareBase(sourceCanvas);
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const workImgData = new ImageData(new Uint8ClampedArray(base.baseImageData.data), base.width, base.height);
    this.applySaturationOnly(base.baseImageData, k, workImgData);
    ctx.putImageData(workImgData, 0, 0);
    return {
      imageData: workImgData,
      polarity: base.polarity
    };
  }

  /**
   * Применяет десатурацию kSat к уже подготовленному baseImageData (занимает < 1 мс)
   */
  applySaturationOnly(baseImageData, kSat, targetImageData) {
    const src = baseImageData.data;
    const dst = targetImageData.data;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const mean = (r + g + b) / 3.0;

      dst[i] = Math.min(255, Math.max(0, Math.round(mean + kSat * (r - mean))));
      dst[i + 1] = Math.min(255, Math.max(0, Math.round(mean + kSat * (g - mean))));
      dst[i + 2] = Math.min(255, Math.max(0, Math.round(mean + kSat * (b - mean))));
      dst[i + 3] = src[i + 3];
    }
  }

  detectPolarity(data, width, height) {
    let darkCount = 0;
    let brightCount = 0;

    // Границы: рамка 5% и центр 50%
    const bY = Math.max(2, Math.floor(height * 0.05));
    const bX = Math.max(2, Math.floor(width * 0.05));
    const cY = Math.floor(height * 0.25);
    const cX = Math.floor(width * 0.25);
    const cEndY = height - cY;
    const cEndX = width - cX;

    let borderSum = 0;
    let borderCount = 0;
    let centerSum = 0;
    let centerCount = 0;

    // Создаем гистограмму яркости для порога Оцу
    const hist = new Int32Array(256);

    for (let y = 0; y < height; y++) {
      const isBorderY = y < bY || y >= height - bY;
      const isCenterY = y >= cY && y < cEndY;

      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Быстрый перевод в оттенки серого (Rec.601)
        const gray = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
        hist[gray]++;

        if (gray < 80) darkCount++;
        if (gray > 160) brightCount++;

        const isBorderX = x < bX || x >= width - bX;
        const isCenterX = x >= cX && x < cEndX;

        if (isBorderY || isBorderX) {
          borderSum += gray;
          borderCount++;
        }
        if (isCenterY && isCenterX) {
          centerSum += gray;
          centerCount++;
        }
      }
    }

    const borderMean = borderCount > 0 ? borderSum / borderCount : 128;
    const centerMean = centerCount > 0 ? centerSum / centerCount : 128;

    // Метод 1: Баланс масс + Сравнение периметра и ядра
    const isNegMethod1 = (darkCount > brightCount * 1.4) || (borderMean < 80 && borderMean < centerMean);

    // Метод 2: Порог Оцу + Топология внешней границы (2px)
    const otsuThreshold = this.calculateOtsu(hist, width * height);
    let border2pxBlack = 0;
    let border2pxTotal = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y < 2 || y >= height - 2 || x < 2 || x >= width - 2) {
          const idx = (y * width + x) * 4;
          const gray = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
          if (gray <= otsuThreshold) border2pxBlack++;
          border2pxTotal++;
        }
      }
    }

    const blackBorderRatio = border2pxTotal > 0 ? border2pxBlack / border2pxTotal : 0;
    const isNegMethod2 = blackBorderRatio > 0.65;

    // Арбитраж
    let finalDecision = false;
    if (isNegMethod1 === isNegMethod2) {
      finalDecision = isNegMethod1;
    } else {
      if (borderMean < 75 && blackBorderRatio > 0.5) {
        finalDecision = true;
      } else {
        finalDecision = false;
      }
    }

    return {
      isInverted: finalDecision,
      isNegMethod1,
      isNegMethod2,
      borderMean,
      centerMean,
      blackBorderRatio
    };
  }

  calculateOtsu(hist, totalPixels) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVar = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  neutralizeBackground(data, width, height, borderPct = 0.03, distThresh = 55, targetBg = [245, 245, 245]) {
    const borderSize = Math.max(10, Math.floor(Math.min(width, height) * borderPct));
    
    // Сбор пикселей рамки
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    const borderSamplesR = [];
    const borderSamplesG = [];
    const borderSamplesB = [];

    // Для ускорения сэмплируем рамку с шагом 2-4
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (y < borderSize || y >= height - borderSize || x < borderSize || x >= width - borderSize) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          borderSamplesR.push(r);
          borderSamplesG.push(g);
          borderSamplesB.push(b);
          rSum += r; gSum += g; bSum += b;
          count++;
        }
      }
    }

    if (count === 0) return;

    // Медиана
    borderSamplesR.sort((a, b) => a - b);
    borderSamplesG.sort((a, b) => a - b);
    borderSamplesB.sort((a, b) => a - b);
    const mid = Math.floor(count / 2);
    const bgR = borderSamplesR[mid];
    const bgG = borderSamplesG[mid];
    const bgB = borderSamplesB[mid];

    // Стандартное отклонение
    let sqDiffSum = 0;
    const rMean = rSum / count;
    const gMean = gSum / count;
    const bMean = bSum / count;
    for (let i = 0; i < count; i++) {
      sqDiffSum += (borderSamplesR[i] - rMean) ** 2 +
                   (borderSamplesG[i] - gMean) ** 2 +
                   (borderSamplesB[i] - bMean) ** 2;
    }
    const stdAvg = Math.sqrt(sqDiffSum / (count * 3));
    if (stdAvg > 40) return; // Рамка слишком пестрая

    const ramp = distThresh * 0.8;
    const maxDist = distThresh * 1.8;

    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - bgR;
      const dg = data[i + 1] - bgG;
      const db = data[i + 2] - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist < maxDist) {
        let mask = (maxDist - dist) / ramp;
        if (mask > 1.0) mask = 1.0;
        if (mask < 0.0) mask = 0.0;

        data[i] = Math.round((1.0 - mask) * data[i] + mask * targetBg[0]);
        data[i + 1] = Math.round((1.0 - mask) * data[i + 1] + mask * targetBg[1]);
        data[i + 2] = Math.round((1.0 - mask) * data[i + 2] + mask * targetBg[2]);
      }
    }
  }

  alignWhitePoint(data, targetWhite = 248) {
    // Вычисляем 98-й перцентиль серого
    const hist = new Int32Array(256);
    const total = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      hist[gray]++;
    }

    const targetCount = Math.floor(total * 0.98);
    let accum = 0;
    let currentWhite = 255;
    for (let i = 0; i < 256; i++) {
      accum += hist[i];
      if (accum >= targetCount) {
        currentWhite = i;
        break;
      }
    }

    if (currentWhite < 10) return;
    const scale = targetWhite / currentWhite;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.round(data[i] * scale));
      data[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
      data[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
    }
  }

  compressSaturation(data, k = 0.42) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mean = (r + g + b) / 3.0;

      data[i] = Math.min(255, Math.max(0, Math.round(mean + k * (r - mean))));
      data[i + 1] = Math.min(255, Math.max(0, Math.round(mean + k * (g - mean))));
      data[i + 2] = Math.min(255, Math.max(0, Math.round(mean + k * (b - mean))));
    }
  }
}
