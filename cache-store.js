/**
 * cache-store.js
 * Персистентное клиентское кэширование в IndexedDB между перезагрузками:
 * - ONNX-модель (ArrayBuffer)
 * - Встроенные сэмплы (Blob + Object URL)
 * - Пользовательские загруженные фото (Blob + метаданные)
 * Результаты сканирования (state.scanResults) намеренно НЕ кэшируются между перезагрузками.
 */

const DB_NAME = 'xray_ml_cache_v1';
const DB_VERSION = 1;

const STORE_MODELS = 'models';
const STORE_SAMPLES = 'samples';
const STORE_CUSTOM = 'customSamples';

export const PREF_STORAGE_KEYS = {
  calib: 'xray_accel_profile_v2',
  settings: 'xray_settings_v1'
};

let dbPromise = null;
const sampleObjectUrls = new Map();
const pendingSamplePromises = new Map();
const pendingModelPromises = new Map();

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MODELS)) {
          db.createObjectStore(STORE_MODELS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_SAMPLES)) {
          db.createObjectStore(STORE_SAMPLES, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_CUSTOM)) {
          db.createObjectStore(STORE_CUSTOM, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetAll(storeName) {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbPut(storeName, record) {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDelete(storeName, key) {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbClear(storeName) {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Загружает или возвращает закэшированный ArrayBuffer ONNX-модели.
 */
export async function getCachedModelBuffer(url) {
  if (pendingModelPromises.has(url)) {
    return pendingModelPromises.get(url);
  }

  const job = (async () => {
    const cached = await idbGet(STORE_MODELS, url);
    if (cached && cached.buffer instanceof ArrayBuffer && cached.buffer.byteLength > 0) {
      return { buffer: cached.buffer, fromCache: true };
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} при загрузке модели ${url}`);
    }
    const buffer = await res.arrayBuffer();
    await idbPut(STORE_MODELS, {
      key: url,
      buffer,
      byteLength: buffer.byteLength,
      updatedAt: Date.now()
    });
    return { buffer, fromCache: false };
  })();

  pendingModelPromises.set(url, job);
  try {
    return await job;
  } finally {
    pendingModelPromises.delete(url);
  }
}

/**
 * Загружает или возвращает закэшированный Blob встроенного сэмпла как Object URL.
 */
export async function getCachedSampleBlobUrl(url) {
  if (sampleObjectUrls.has(url)) {
    return sampleObjectUrls.get(url);
  }
  if (pendingSamplePromises.has(url)) {
    return pendingSamplePromises.get(url);
  }

  const job = (async () => {
    try {
      const cached = await idbGet(STORE_SAMPLES, url);
      let blob = cached?.blob instanceof Blob ? cached.blob : null;

      if (!blob) {
        const res = await fetch(url);
        if (!res.ok) {
          return url;
        }
        blob = await res.blob();
        await idbPut(STORE_SAMPLES, {
          key: url,
          blob,
          byteLength: blob.size,
          updatedAt: Date.now()
        });
      }

      const objectUrl = URL.createObjectURL(blob);
      sampleObjectUrls.set(url, objectUrl);
      return objectUrl;
    } catch {
      return url;
    }
  })();

  pendingSamplePromises.set(url, job);
  try {
    return await job;
  } finally {
    pendingSamplePromises.delete(url);
  }
}

export async function listCustomSamples() {
  const rows = await idbGetAll(STORE_CUSTOM);
  return rows
    .filter(r => r && r.id && r.blob instanceof Blob)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function saveCustomSample({ id, name, blob, addedAt = Date.now() }) {
  if (!id || !(blob instanceof Blob)) return false;
  return idbPut(STORE_CUSTOM, {
    id,
    name,
    blob,
    byteLength: blob.size,
    addedAt
  });
}

export async function deleteCustomSampleRecord(id) {
  return idbDelete(STORE_CUSTOM, id);
}

export async function clearCustomSamplesStore() {
  return idbClear(STORE_CUSTOM);
}

export async function clearModelCache() {
  const ok = await idbClear(STORE_MODELS);
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('xray-')).map(k => caches.delete(k))
      );
    } catch {
      // ignore Cache Storage errors
    }
  }
  return ok;
}

export async function clearSamplesCache() {
  for (const objectUrl of sampleObjectUrls.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  }
  sampleObjectUrls.clear();
  return idbClear(STORE_SAMPLES);
}

export async function getCacheStats() {
  const [models, samples, custom] = await Promise.all([
    idbGetAll(STORE_MODELS),
    idbGetAll(STORE_SAMPLES),
    idbGetAll(STORE_CUSTOM)
  ]);

  const sumBytes = (rows, fallbackProp) =>
    rows.reduce((acc, r) => {
      if (typeof r?.byteLength === 'number') return acc + r.byteLength;
      const val = r?.[fallbackProp];
      if (val && typeof val.byteLength === 'number') return acc + val.byteLength;
      if (val && typeof val.size === 'number') return acc + val.size;
      return acc;
    }, 0);

  const modelBytes = sumBytes(models, 'buffer');
  const samplesBytes = sumBytes(samples, 'blob');
  const customBytes = sumBytes(custom, 'blob');

  return {
    modelBytes,
    modelCount: models.length,
    samplesBytes,
    samplesCount: samples.length,
    customBytes,
    customCount: custom.length,
    totalBytes: modelBytes + samplesBytes + customBytes
  };
}

export async function clearAllPersistentCaches({ clearPrefs = true } = {}) {
  await Promise.all([
    clearModelCache(),
    clearSamplesCache(),
    clearCustomSamplesStore()
  ]);

  if (clearPrefs) {
    try {
      localStorage.removeItem(PREF_STORAGE_KEYS.calib);
      localStorage.removeItem(PREF_STORAGE_KEYS.settings);
    } catch {
      // ignore storage errors
    }
  }
}
