/**
 * diagpu/diagpu.js
 * Полная диагностика GPU (WebGPU, WGSL Compute, WebGL2, Secure Context, ONNX Runtime Web)
 * с матрицей численного паритета GPU vs WASM и рекомендациями по разблокировке.
 */

import { loadReferenceChw } from '../debug/accel-engine.js?v=2';

const MODEL_PATH = '../models/best_dynamic.onnx';

const els = {
  btnRunDiag: document.getElementById('btnRunDiag'),
  btnRunBench: document.getElementById('btnRunBench'),
  btnCopyJson: document.getElementById('btnCopyJson'),
  verdictStatus: document.getElementById('verdictStatus'),
  verdictReasons: document.getElementById('verdictReasons'),
  envPill: document.getElementById('envPill'),
  envList: document.getElementById('envList'),
  webgpuPill: document.getElementById('webgpuPill'),
  webgpuList: document.getElementById('webgpuList'),
  webglPill: document.getElementById('webglPill'),
  webglList: document.getElementById('webglList'),
  limitsPill: document.getElementById('limitsPill'),
  limitsList: document.getElementById('limitsList'),
  ortPill: document.getElementById('ortPill'),
  benchTbody: document.getElementById('benchTbody'),
  rawJsonPre: document.getElementById('rawJsonPre')
};

const report = {
  timestamp: null,
  env: {},
  webgpu: {},
  webgl2: {},
  onnxBench: [],
  diagnosis: []
};

function setPill(el, text, kind = 'warn') {
  el.textContent = text;
  el.className = `diag-pill diag-pill--${kind}`;
}

function renderKV(container, entries) {
  container.innerHTML = '';
  for (const [k, v] of entries) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const keySpan = document.createElement('span');
    keySpan.className = 'kv-key';
    keySpan.textContent = k;
    const valSpan = document.createElement('span');
    valSpan.className = 'kv-val';
    valSpan.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
    row.appendChild(keySpan);
    row.appendChild(valSpan);
    container.appendChild(row);
  }
}

function probeEnvironment() {
  const env = {
    origin: window.location.origin,
    protocol: window.location.protocol,
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    deviceMemoryGB: navigator.deviceMemory || 'unknown',
    platform: navigator.platform || 'unknown',
    userAgent: navigator.userAgent
  };
  report.env = env;

  renderKV(els.envList, [
    ['isSecureContext', env.isSecureContext ? 'true (OK)' : 'FALSE (Блокирует WebGPU!)'],
    ['origin', env.origin],
    ['crossOriginIsolated', String(env.crossOriginIsolated)],
    ['SharedArrayBuffer', String(env.sharedArrayBuffer)],
    ['CPU cores', String(env.hardwareConcurrency)],
    ['RAM (deviceMemory)', `${env.deviceMemoryGB} GB`],
    ['UserAgent', env.userAgent]
  ]);

  if (!env.isSecureContext) {
    setPill(els.envPill, 'НЕ БЕЗОПАСНЫЙ КОНТЕКСТ', 'err');
  } else if (!env.crossOriginIsolated) {
    setPill(els.envPill, 'Нет COOP/COEP', 'warn');
  } else {
    setPill(els.envPill, 'OK (Isolated)', 'ok');
  }
}

async function probeWebGPU() {
  const gpu = {
    navigatorGpu: Boolean(navigator.gpu),
    highPerfAdapter: null,
    lowPowerAdapter: null,
    info: null,
    isFallbackAdapter: null,
    features: [],
    limits: {},
    wgslComputeOk: false,
    wgslComputeMs: null,
    error: null
  };

  if (!navigator.gpu) {
    gpu.error = window.isSecureContext
      ? 'navigator.gpu отсутствует в этом браузере'
      : 'navigator.gpu скрыт браузером, т.к. страница открыта не по HTTPS/localhost';
    report.webgpu = gpu;
    setPill(els.webgpuPill, 'Недоступен', 'err');
    renderKV(els.webgpuList, [['navigator.gpu', 'undefined'], ['Причина', gpu.error]]);
    setPill(els.limitsPill, 'Нет адаптера', 'err');
    renderKV(els.limitsList, [['Статус', 'Адаптер WebGPU не найден']]);
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const lowAdapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    gpu.highPerfAdapter = Boolean(adapter);
    gpu.lowPowerAdapter = Boolean(lowAdapter);

    const activeAdapter = adapter || lowAdapter;
    if (!activeAdapter) {
      gpu.error = 'requestAdapter() вернул null (драйвер заблокирован или нет Vulkan/Metal/DX12)';
      report.webgpu = gpu;
      setPill(els.webgpuPill, 'Adapter = null', 'err');
      renderKV(els.webgpuList, [['navigator.gpu', 'true'], ['requestAdapter()', 'null'], ['Причина', gpu.error]]);
      setPill(els.limitsPill, 'Нет адаптера', 'err');
      renderKV(els.limitsList, [['Статус', 'Адаптер WebGPU вернул null']]);
      return;
    }

    gpu.isFallbackAdapter = activeAdapter.isFallbackAdapter ?? false;
    gpu.info = {
      vendor: activeAdapter.info?.vendor || 'unknown',
      architecture: activeAdapter.info?.architecture || 'unknown',
      device: activeAdapter.info?.device || 'unknown',
      description: activeAdapter.info?.description || 'unknown'
    };
    gpu.features = Array.from(activeAdapter.features || []);
    const lim = activeAdapter.limits;
    gpu.limits = {
      maxBufferSizeMB: Math.round((lim.maxBufferSize || 0) / (1024 * 1024)),
      maxStorageBufferBindingSizeMB: Math.round((lim.maxStorageBufferBindingSize || 0) / (1024 * 1024)),
      maxComputeWorkgroupStorageSize: lim.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: lim.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: lim.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupsPerDimension: lim.maxComputeWorkgroupsPerDimension
    };

    const device = await activeAdapter.requestDevice();
    const count = 262144;
    const byteSize = count * 4;
    const shaderCode = `
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let idx = id.x;
        if (idx < ${count}u) {
          data[idx] = data[idx] * 2.0 + 1.0;
        }
      }
    `;
    const t0 = performance.now();
    const storageBuf = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const readBuf = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(storageBuf, 0, new Float32Array(count).fill(3.0));

    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: storageBuf } }]
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    enc.copyBufferToBuffer(storageBuf, 0, readBuf, 0, byteSize);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const outArr = new Float32Array(readBuf.getMappedRange());
    const valid = outArr[0] === 7.0 && outArr[count - 1] === 7.0;
    readBuf.unmap();
    storageBuf.destroy();
    readBuf.destroy();
    device.destroy();

    gpu.wgslComputeOk = valid;
    gpu.wgslComputeMs = +(performance.now() - t0).toFixed(2);
    setPill(els.webgpuPill, valid ? 'WGSL Compute OK' : 'Ошибка расчёта', valid ? 'ok' : 'err');
  } catch (err) {
    gpu.error = err.message || String(err);
    setPill(els.webgpuPill, 'Ошибка WebGPU', 'err');
  }

  report.webgpu = gpu;
  renderKV(els.webgpuList, [
    ['navigator.gpu', String(gpu.navigatorGpu)],
    ['high-performance adapter', String(gpu.highPerfAdapter)],
    ['vendor / arch', `${gpu.info?.vendor || '-'} / ${gpu.info?.architecture || '-'}`],
    ['description', gpu.info?.description || '-'],
    ['isFallbackAdapter (CPU?)', String(gpu.isFallbackAdapter)],
    ['WGSL Compute 1MB', gpu.wgslComputeOk ? `OK (${gpu.wgslComputeMs} ms)` : `FAIL (${gpu.error || 'unknown'})`]
  ]);

  const hasF16 = gpu.features.includes('shader-f16');
  setPill(els.limitsPill, hasF16 ? 'shader-f16: YES' : 'shader-f16: NO', hasF16 ? 'ok' : 'warn');
  renderKV(els.limitsList, [
    ['shader-f16 (FP16)', hasF16 ? 'Поддерживается' : 'Нет (только FP32)'],
    ['maxBufferSize', `${gpu.limits.maxBufferSizeMB || 0} MB`],
    ['maxStorageBinding', `${gpu.limits.maxStorageBufferBindingSizeMB || 0} MB`],
    ['workgroupStorage', `${gpu.limits.maxComputeWorkgroupStorageSize || 0} B`],
    ['maxInvocations/WG', String(gpu.limits.maxComputeInvocationsPerWorkgroup || 0)],
    ['features count', String(gpu.features.length)]
  ]);
}

function probeWebGL2() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    report.webgl2 = { supported: false };
    setPill(els.webglPill, 'Недоступен', 'err');
    renderKV(els.webglList, [['WebGL2', 'false']]);
    return;
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const floatTex = Boolean(gl.getExtension('EXT_color_buffer_float'));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  report.webgl2 = {
    supported: true,
    vendor,
    renderer,
    maxTextureSize: maxTex,
    extColorBufferFloat: floatTex
  };

  const isSoftware = /swiftshader|llvmpipe|software/i.test(renderer);
  setPill(els.webglPill, isSoftware ? 'Software GL' : 'Hardware WebGL2', isSoftware ? 'warn' : 'ok');
  renderKV(els.webglList, [
    ['UNMASKED_VENDOR', vendor],
    ['UNMASKED_RENDERER', renderer],
    ['MAX_TEXTURE_SIZE', `${maxTex} px`],
    ['EXT_color_buffer_float', String(floatTex)]
  ]);
}

function buildDiagnosis() {
  const reasons = [];
  let headline = '✅ WebGPU готов к работе';

  if (!report.env.isSecureContext) {
    headline = '❌ GPU заблокирован небезопасным контекстом (HTTP по IP)';
    reasons.push('Страница открыта по обычному HTTP не на localhost (isSecureContext = false). Браузеры принудительно удаляют navigator.gpu.');
    reasons.push('Как достать GPU на телефоне: поднимите HTTPS (ngrok / cloudflared / локальный SSL) ИЛИ в Chrome на Android откройте chrome://flags/#unsafely-treat-insecure-origin-as-secure и добавьте http://<IP>:8080.');
  } else if (!report.webgpu.navigatorGpu) {
    headline = '❌ Браузер не поддерживает WebGPU';
    reasons.push('navigator.gpu отсутствует. Обновите Chrome (Android 12+ / Desktop) или Safari (iOS 17+/26).');
  } else if (!report.webgpu.highPerfAdapter && !report.webgpu.lowPowerAdapter) {
    headline = '❌ WebGPU есть в API, но драйвер не выдал GPU-адаптер (null)';
    reasons.push('На Linux Chrome WebGPU часто отключён по умолчанию без Vulkan: запустите Chrome с флагами --enable-unsafe-webgpu --enable-features=Vulkan или включите chrome://flags/#enable-unsafe-webgpu.');
    reasons.push(`При этом WebGL2 видит видеокарту: ${report.webgl2.renderer || 'не определена'} (возможен путь миграции на WebGL2 / TF.js при необходимости).`);
  } else if (report.webgpu.isFallbackAdapter) {
    headline = '⚠️ WebGPU работает на программном эмуляторе (CPU fallback)';
    reasons.push('Адаптер помечен как isFallbackAdapter=true — реального ускорения от него не будет, лучше использовать WASM SIMD.');
  } else if (!report.webgpu.wgslComputeOk) {
    headline = '❌ Ошибка выполнения WGSL Compute Shader';
    reasons.push(`Адаптер найден (${report.webgpu.info?.description}), но compute shader упал: ${report.webgpu.error}`);
  } else {
    reasons.push(`Аппаратный WebGPU работает: ${report.webgpu.info?.description || report.webgpu.info?.vendor} (WGSL 1MB за ${report.webgpu.wgslComputeMs} мс).`);
    reasons.push(`shader-f16: ${report.webgpu.features.includes('shader-f16') ? 'поддерживается' : 'не поддерживается (используется FP32)'}.`);
    if (report.webgpu.limits.maxBufferSizeMB < 256) {
      reasons.push(`Низкий maxBufferSize (${report.webgpu.limits.maxBufferSizeMB} MB) — безопаснее batch=2.`);
    }
    reasons.push('Запустите «⚡ Бенчмарк ONNX (GPU vs WASM)» ниже для проверки численного паритета на реальном рентгене image9.png.');
  }

  if (!report.env.crossOriginIsolated) {
    reasons.push('Внимание: crossOriginIsolated = false, многопоточный WASM может быть отключён.');
  }

  report.diagnosis = reasons;
  els.verdictStatus.textContent = headline;
  els.verdictReasons.innerHTML = '';
  reasons.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r;
    els.verdictReasons.appendChild(li);
  });
}

function analyzeTensorOutput(data, dims) {
  const [batch, channels, numBoxes] = dims;
  let nans = 0;
  let zeros = 0;
  for (let i = 0; i < data.length; i++) {
    if (Number.isNaN(data[i])) nans++;
    else if (data[i] === 0) zeros++;
  }
  const zeroRatio = +(zeros / data.length).toFixed(3);
  let maxConf = 0;
  let boxesGe20 = 0;
  for (let i = 0; i < numBoxes; i++) {
    const c = data[4 * numBoxes + i];
    if (c > maxConf) maxConf = c;
    if (c >= 0.20) boxesGe20++;
  }
  return { batch, maxConf: +maxConf.toFixed(4), boxesGe20, nans, zeroRatio };
}

async function runOnnxBenchmarks() {
  if (!window.ort) {
    setPill(els.ortPill, 'ORT не загружен', 'err');
    return;
  }

  els.btnRunBench.disabled = true;
  setPill(els.ortPill, 'Подготовка эталона...', 'warn');
  els.benchTbody.innerHTML = '';
  report.onnxBench = [];

  const appendRow = (row) => {
    report.onnxBench.push(row);
    const tr = document.createElement('tr');
    const parityBadge = row.parity === 'OK'
      ? '<span style="color:#10B981;font-weight:700">OK</span>'
      : row.parity === 'REF'
        ? '<span style="color:#00ADB5;font-weight:700">ЭТАЛОН</span>'
        : `<span style="color:#EF4444;font-weight:700">${row.parity}</span>`;

    tr.innerHTML = `
      <td data-label="Провайдер"><strong>${row.provider}</strong></td>
      <td data-label="Конфиг">${row.config}</td>
      <td data-label="Статус">${row.ok ? '<span style="color:#10B981">OK</span>' : '<span style="color:#EF4444">FAIL</span>'}</td>
      <td data-label="Паритет">${row.parity ? parityBadge : '—'}</td>
      <td data-label="Старт">${row.initMs !== null ? `${row.initMs} ms` : '—'}</td>
      <td data-label="Прогон">${row.runMs !== null ? `${row.runMs} ms` : '—'}</td>
      <td data-label="На кадр">${row.perFrameMs !== null ? `<strong>${row.perFrameMs} ms</strong>` : '—'}</td>
      <td data-label="Детали">${row.detail}</td>
    `;
    els.benchTbody.appendChild(tr);
    els.rawJsonPre.textContent = JSON.stringify(report, null, 2);
  };

  let refChw = null;
  try {
    refChw = await loadReferenceChw('../samples/image9.png', 0.42, 640);
  } catch (err) {
    refChw = new Float32Array(3 * 640 * 640);
  }

  const makeBatchTensor = (B) => {
    const arr = new Float32Array(B * 3 * 640 * 640);
    for (let b = 0; b < B; b++) arr.set(refChw, b * 3 * 640 * 640);
    return new window.ort.Tensor('float32', arr, [B, 3, 640, 640]);
  };

  // 1. WASM SIMD reference first (получаем эталонный maxConf на image9.png)
  setPill(els.ortPill, 'Тест WASM эталона...', 'warn');
  let wasmRefMaxConf = null;
  const cores = navigator.hardwareConcurrency || 4;
  for (const threads of [1, Math.max(1, cores - 1)]) {
    let wasmSession = null;
    let t = null;
    let out = null;
    try {
      window.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
      window.ort.env.wasm.numThreads = threads;
      window.ort.env.wasm.simd = true;

      const t0 = performance.now();
      wasmSession = await window.ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['wasm'] });
      const initMs = Math.round(performance.now() - t0);

      t = makeBatchTensor(1);
      const tr0 = performance.now();
      const res = await wasmSession.run({ [wasmSession.inputNames[0]]: t });
      out = res[wasmSession.outputNames[0]];
      const runMs = Math.round(performance.now() - tr0);
      const stats = analyzeTensorOutput(out.data, out.dims);
      if (wasmRefMaxConf === null) wasmRefMaxConf = stats.maxConf;

      appendRow({
        provider: 'wasm',
        config: `threads=${threads}, batch=1`,
        ok: true,
        parity: 'REF',
        initMs,
        runMs,
        perFrameMs: runMs,
        detail: `maxConf=${stats.maxConf}, boxes>=0.20: ${stats.boxesGe20}, zeros=${stats.zeroRatio}`
      });
    } catch (err) {
      appendRow({
        provider: 'wasm',
        config: `threads=${threads}`,
        ok: false,
        parity: 'FAIL',
        initMs: null,
        runMs: null,
        perFrameMs: null,
        detail: err.message || String(err)
      });
    } finally {
      t?.dispose?.();
      out?.dispose?.();
      await wasmSession?.release?.().catch(() => {});
    }
  }

  // 2. WebGPU Matrix (NCHW vs auto × opt=all vs opt=basic)
  if (navigator.gpu) {
    if (window.ort.env?.webgpu) {
      window.ort.env.webgpu.powerPreference = 'high-performance';
    }
    const matrix = [
      { label: 'NCHW + all', preferredLayout: 'NCHW', optLevel: 'all', batches: [1, 2, 4] },
      { label: 'NCHW + basic', preferredLayout: 'NCHW', optLevel: 'basic', batches: [2] },
      { label: 'default + basic', preferredLayout: null, optLevel: 'basic', batches: [2] },
      { label: 'default + all', preferredLayout: null, optLevel: 'all', batches: [2] }
    ];

    for (const cfg of matrix) {
      setPill(els.ortPill, `Тест WebGPU (${cfg.label})...`, 'warn');
      let gpuSession = null;
      let initMs = null;
      try {
        const epOpt = cfg.preferredLayout ? { name: 'webgpu', preferredLayout: cfg.preferredLayout } : 'webgpu';
        const t0 = performance.now();
        gpuSession = await window.ort.InferenceSession.create(MODEL_PATH, {
          executionProviders: [epOpt],
          graphOptimizationLevel: cfg.optLevel
        });
        initMs = Math.round(performance.now() - t0);

        for (const b of cfg.batches) {
          let t = null;
          let out = null;
          try {
            t = makeBatchTensor(b);
            const tr0 = performance.now();
            const res = await gpuSession.run({ [gpuSession.inputNames[0]]: t });
            out = res[gpuSession.outputNames[0]];
            const data = typeof out.getData === 'function' ? await out.getData() : out.data;
            const runMs = Math.round(performance.now() - tr0);
            const stats = analyzeTensorOutput(data, out.dims);

            const parityOk = stats.nans === 0
              && stats.zeroRatio < 0.5
              && (wasmRefMaxConf === null || (stats.maxConf >= 0.25 && Math.abs(stats.maxConf - wasmRefMaxConf) <= 0.08));

            appendRow({
              provider: 'webgpu',
              config: `${cfg.label} · batch=${b}`,
              ok: true,
              parity: parityOk ? 'OK' : 'НУЛИ/РАСХОД',
              initMs,
              runMs,
              perFrameMs: +(runMs / b).toFixed(1),
              detail: `maxConf=${stats.maxConf} (ref=${wasmRefMaxConf}), boxes=${stats.boxesGe20}, zeros=${stats.zeroRatio}, NaN=${stats.nans}`
            });
          } catch (runErr) {
            appendRow({
              provider: 'webgpu',
              config: `${cfg.label} · batch=${b}`,
              ok: false,
              parity: 'ERR',
              initMs,
              runMs: null,
              perFrameMs: null,
              detail: runErr.message || String(runErr)
            });
          } finally {
            t?.dispose?.();
            out?.dispose?.();
          }
        }
      } catch (initErr) {
        appendRow({
          provider: 'webgpu',
          config: `${cfg.label} · create`,
          ok: false,
          parity: 'ERR',
          initMs: null,
          runMs: null,
          perFrameMs: null,
          detail: initErr.message || String(initErr)
        });
      } finally {
        await gpuSession?.release?.().catch(() => {});
      }
    }
  } else {
    appendRow({
      provider: 'webgpu',
      config: '—',
      ok: false,
      parity: 'N/A',
      initMs: null,
      runMs: null,
      perFrameMs: null,
      detail: 'navigator.gpu отсутствует'
    });
  }

  setPill(els.ortPill, 'Тест завершён', 'ok');
  els.btnRunBench.disabled = false;
}

async function runAllDiagnostics() {
  report.timestamp = new Date().toISOString();
  probeEnvironment();
  await probeWebGPU();
  probeWebGL2();
  buildDiagnosis();
  els.rawJsonPre.textContent = JSON.stringify(report, null, 2);
}

els.btnRunDiag.addEventListener('click', runAllDiagnostics);
els.btnRunBench.addEventListener('click', runOnnxBenchmarks);
els.btnCopyJson.addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    .then(() => { els.btnCopyJson.textContent = '✅ Скопировано'; setTimeout(() => { els.btnCopyJson.textContent = '📋 Копировать JSON'; }, 1500); })
    .catch(err => console.error(err));
});

runAllDiagnostics();
