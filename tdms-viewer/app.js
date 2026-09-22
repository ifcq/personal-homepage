(function () {
  "use strict";

  const COLORS = ["#0d927e", "#c58a16", "#d44b61", "#3d78cf", "#8d5cc7", "#168eae", "#cf6f32", "#599c39"];
  const MAX_VIEWERS = 8;
  const $ = (selector, root = document) => root.querySelector(selector);
  const grid = $("#observerGrid");
  const template = $("#observerTemplate");
  const addViewerButton = $("#addViewer");
  const columnSelect = $("#columnSelect");
  const syncXToggle = $("#syncXToggle");
  const viewerSummary = $("#viewerSummary");
  const viewerLimit = $("#viewerLimit");
  const toastElement = $("#toast");

  const app = {
    viewers: [],
    nextId: 1,
    columns: 2,
    syncX: false,
    toastTimer: 0,
  };

  function demoDataset() {
    const length = 12000;
    const make = (phase, scale, drift) => {
      const data = new Float64Array(length);
      let calcium = 0;
      for (let i = 0; i < length; i += 1) {
        const event = (i + phase * 90) % 1730;
        if (event < 9) calcium += scale * (1 - event / 9);
        calcium *= 0.993;
        const noise = Math.sin(i * 1.731 + phase) * .12 + Math.sin(i * .071) * .08;
        data[i] = 8 + drift * i / length + Math.sin(i / 430 + phase) * .7 + calcium + noise;
      }
      return data;
    };
    return {
      fileName: "演示波形",
      sampleCount: length,
      segmentCount: 1,
      fileProperties: {},
      warnings: [],
      demo: true,
      channels: [
        { id: "demo-470", name: "Cal470", group: "演示数据", data: make(.2, 5.2, .5), typeName: "Float64", properties: {} },
        { id: "demo-410", name: "Cal410", group: "演示数据", data: make(2.1, 2.8, -.2), typeName: "Float64", properties: {} },
        { id: "demo-ref", name: "Reference", group: "演示数据", data: make(4.5, 1.5, .1), typeName: "Float64", properties: {} },
      ],
    };
  }

  function createViewer(options = {}) {
    if (app.viewers.length >= MAX_VIEWERS) {
      toast(`最多可添加 ${MAX_VIEWERS} 个观察器`, true);
      return null;
    }

    const element = template.content.firstElementChild.cloneNode(true);
    const id = app.nextId++;
    element.dataset.viewerId = String(id);
    const refs = collectRefs(element);
    refs.canvas.id = `chartCanvas-${id}`;
    refs.canvas.setAttribute("aria-label", `观察器 ${app.viewers.length + 1} 波形图`);

    const viewer = {
      id,
      element,
      refs,
      dataset: null,
      selected: new Set(),
      start: 0,
      end: 1,
      yManual: false,
      yMin: 0,
      yMax: 1,
      lastYMin: 0,
      lastYMax: 1,
      drag: null,
      rangeDrag: null,
      raf: 0,
      resizeObserver: null,
    };

    app.viewers.push(viewer);
    grid.appendChild(element);
    bindViewer(viewer);
    setViewerEnabled(viewer, false);
    updateViewerLabels();

    if (options.demo) setDataset(viewer, demoDataset());
    else render(viewer);

    return viewer;
  }

  function collectRefs(root) {
    const one = (name) => $(name, root);
    return {
      viewerIndex: one(".viewer-index"), fileName: one(".file-name"), fileBadge: one(".file-badge"), fileMeta: one(".file-meta"),
      remove: one(".remove-viewer"), dropZone: one(".drop-zone"), fileInput: one(".file-input"), exportScope: one(".export-scope"),
      exportButton: one(".export-button"), statusBar: one(".status-bar"), statusTitle: one(".status-title"), statusText: one(".status-text"),
      sampleRate: one(".sample-rate"), smooth: one(".smooth-select"), normalize: one(".normalize-toggle"), xUnit: one(".x-unit-select"),
      xMin: one(".x-min"), xMax: one(".x-max"), yMin: one(".y-min"), yMax: one(".y-max"),
      autoX: one(".auto-x"), autoY: one(".auto-y"), reset: one(".reset-view"),
      channelCount: one(".channel-count"), channelList: one(".channel-list"), toggleAll: one(".toggle-all"),
      chartPanel: one(".chart-panel"), chartWrap: one(".chart-wrap"), canvas: one(".chart-canvas"), emptyChart: one(".empty-chart"),
      tooltip: one(".chart-tooltip"), viewLabel: one(".view-label"), visiblePoints: one(".visible-points"), visibleRange: one(".visible-range"),
      expand: one(".expand-button"), rangeRail: one(".range-rail"), rangeWindow: one(".range-window"),
      rangeLeft: one(".range-handle-left"), rangeRight: one(".range-handle-right"), formatNote: one(".format-note"),
    };
  }

  function bindViewer(viewer) {
    const r = viewer.refs;

    r.dropZone.addEventListener("click", () => r.fileInput.click());
    r.dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); r.fileInput.click(); }
    });
    r.fileInput.addEventListener("change", () => loadFile(viewer, r.fileInput.files[0]));
    ["dragenter", "dragover"].forEach((type) => r.dropZone.addEventListener(type, (event) => {
      event.preventDefault(); r.dropZone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((type) => r.dropZone.addEventListener(type, (event) => {
      event.preventDefault(); r.dropZone.classList.remove("dragging");
    }));
    r.dropZone.addEventListener("drop", (event) => loadFile(viewer, event.dataTransfer.files[0]));

    r.smooth.addEventListener("change", () => render(viewer));
    r.sampleRate.addEventListener("input", () => render(viewer));
    r.sampleRate.addEventListener("change", () => {
      if (r.xUnit.value === "seconds" && !getSampleRate(viewer)) {
        r.xUnit.value = "samples";
        toast("使用秒作为 X 轴单位前，请先设置有效的采样频率", true);
      }
      render(viewer);
    });
    r.xUnit.addEventListener("change", () => {
      if (r.xUnit.value === "seconds" && !getSampleRate(viewer)) {
        r.xUnit.value = "samples";
        toast("请先填写采样频率，再选择秒", true);
      }
      viewer.forceXAxisInputs = true;
      render(viewer);
    });
    r.normalize.addEventListener("change", () => {
      viewer.yManual = false;
      render(viewer);
    });
    [r.xMin, r.xMax].forEach((input) => {
      input.addEventListener("input", () => applyXInputs(viewer, { silent: true }));
      input.addEventListener("change", () => applyXInputs(viewer));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyXInputs(viewer);
      });
    });
    [r.yMin, r.yMax].forEach((input) => {
      input.addEventListener("input", () => applyYInputs(viewer, { silent: true }));
      input.addEventListener("change", () => applyYInputs(viewer));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyYInputs(viewer);
      });
    });
    r.autoX.addEventListener("click", () => setView(viewer, 0, viewer.dataset.sampleCount));
    r.autoY.addEventListener("click", () => { viewer.yManual = false; render(viewer); });
    r.reset.addEventListener("click", () => resetView(viewer));
    r.exportButton.addEventListener("click", () => exportCsv(viewer));
    r.remove.addEventListener("click", () => removeViewer(viewer));
    r.toggleAll.addEventListener("click", () => toggleAllChannels(viewer));
    r.expand.addEventListener("click", () => toggleExpanded(viewer));

    bindChartInteractions(viewer);
    bindRangeInteractions(viewer);
    viewer.resizeObserver = new ResizeObserver(() => queueRender(viewer));
    viewer.resizeObserver.observe(r.chartWrap);
  }

  function setViewerEnabled(viewer, enabled) {
    const r = viewer.refs;
    [r.exportScope, r.exportButton, r.sampleRate, r.smooth, r.normalize, r.xUnit, r.xMin, r.xMax, r.yMin, r.yMax,
      r.autoX, r.autoY, r.reset, r.toggleAll, r.expand].forEach((control) => { control.disabled = !enabled; });
    r.emptyChart.hidden = enabled;
  }

  function scanStats(dataset) {
    dataset.channels.forEach((channel, index) => {
      let min = Infinity, max = -Infinity, sum = 0, valid = 0;
      for (let i = 0; i < channel.data.length; i += 1) {
        const value = channel.data[i];
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
        sum += value;
        valid += 1;
      }
      channel.min = valid ? min : 0;
      channel.max = valid ? max : 1;
      channel.mean = valid ? sum / valid : 0;
      channel.color = COLORS[index % COLORS.length];
    });
  }

  function setDataset(viewer, dataset) {
    scanStats(dataset);
    viewer.dataset = dataset;
    viewer.selected = new Set(dataset.channels.map((channel) => channel.id));
    viewer.start = 0;
    viewer.end = Math.max(1, dataset.sampleCount);
    viewer.yManual = false;

    const r = viewer.refs;
    r.fileName.textContent = dataset.fileName.replace(/\.tdms$/i, "");
    r.fileBadge.textContent = dataset.demo ? "DEMO" : "TDMS";
    r.fileBadge.classList.remove("empty");
    r.fileMeta.textContent = `${dataset.channels.length} 个通道 · ${formatInt(dataset.sampleCount)} 个采样点 · ${dataset.segmentCount} 个数据段`;
    const inferredIncrement = dataset.channels.find((channel) => Number(channel.properties?.wf_increment) > 0)?.properties?.wf_increment;
    r.sampleRate.value = inferredIncrement && inferredIncrement !== 1 ? String(1 / inferredIncrement) : "";
    r.xUnit.value = "samples";
    r.formatNote.textContent = dataset.warnings?.length ? dataset.warnings[0] : "支持常见 TDMS 数值通道";
    r.xMin.min = "0";
    r.xMax.max = String(Math.max(0, dataset.sampleCount - 1));
    setViewerEnabled(viewer, true);
    buildChannelList(viewer);
    render(viewer);
  }

  function buildChannelList(viewer) {
    const r = viewer.refs;
    r.channelList.replaceChildren();
    viewer.dataset.channels.forEach((channel, index) => {
      const label = document.createElement("label");
      label.className = "channel-item";
      label.dataset.id = channel.id;
      label.innerHTML = `
        <input type="checkbox" checked aria-label="显示 ${escapeHtml(channel.name)}" />
        <span class="channel-dot" style="color:${channel.color};background:${channel.color}"></span>
        <span class="channel-copy"><strong>${escapeHtml(channel.name || `通道 ${index + 1}`)}</strong><span>${escapeHtml(channel.group || "未分组")} · ${channel.typeName}</span></span>
        <span class="channel-value">${formatNumber(channel.mean)}</span>`;
      label.querySelector("input").addEventListener("change", (event) => {
        if (event.target.checked) viewer.selected.add(channel.id); else viewer.selected.delete(channel.id);
        label.classList.toggle("off", !event.target.checked);
        updateChannelHeader(viewer);
        render(viewer);
      });
      r.channelList.appendChild(label);
    });
    updateChannelHeader(viewer);
  }

  function updateChannelHeader(viewer) {
    if (!viewer.dataset) return;
    viewer.refs.channelCount.textContent = `${viewer.selected.size} / ${viewer.dataset.channels.length} 已显示`;
    viewer.refs.toggleAll.textContent = viewer.selected.size ? "全部隐藏" : "全部显示";
  }

  function toggleAllChannels(viewer) {
    if (!viewer.dataset) return;
    const show = viewer.selected.size === 0;
    viewer.selected = new Set(show ? viewer.dataset.channels.map((channel) => channel.id) : []);
    viewer.refs.channelList.querySelectorAll(".channel-item").forEach((item) => {
      item.classList.toggle("off", !show);
      item.querySelector("input").checked = show;
    });
    updateChannelHeader(viewer);
    render(viewer);
  }

  function selectedChannels(viewer) {
    return viewer.dataset ? viewer.dataset.channels.filter((channel) => viewer.selected.has(channel.id)) : [];
  }

  function updateViewerLabels() {
    app.viewers.forEach((viewer, index) => {
      viewer.refs.viewerIndex.textContent = `观察器 ${index + 1}`;
      viewer.refs.remove.disabled = app.viewers.length === 1;
    });
    viewerSummary.textContent = `${app.viewers.length} 个观察器`;
    viewerLimit.textContent = `最多 ${MAX_VIEWERS} 个`;
    addViewerButton.disabled = app.viewers.length >= MAX_VIEWERS;
  }

  function removeViewer(viewer) {
    if (app.viewers.length === 1) return;
    if (viewer.refs.chartPanel.classList.contains("chart-expanded")) document.body.classList.remove("chart-focus");
    viewer.resizeObserver?.disconnect();
    if (viewer.raf) cancelAnimationFrame(viewer.raf);
    viewer.dataset = null;
    viewer.element.remove();
    app.viewers = app.viewers.filter((item) => item !== viewer);
    updateViewerLabels();
    toast("观察器已删除，内存中的文件数据已释放");
  }

  function setColumns(columns) {
    app.columns = Math.max(1, Math.min(3, Number(columns) || 2));
    grid.className = `workspace-grid cols-${app.columns}`;
    columnSelect.value = String(app.columns);
    try { localStorage.setItem("tdms-viewer-columns", String(app.columns)); } catch (_) {}
    app.viewers.forEach(queueRender);
  }

  function queueRender(viewer) {
    if (!viewer || viewer.raf) return;
    viewer.raf = requestAnimationFrame(() => { viewer.raf = 0; render(viewer); });
  }

  function render(viewer) {
    const r = viewer.refs;
    const rect = r.chartWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(260, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));
    if (r.canvas.width !== Math.round(width * dpr) || r.canvas.height !== Math.round(height * dpr)) {
      r.canvas.width = Math.round(width * dpr);
      r.canvas.height = Math.round(height * dpr);
    }
    const ctx = r.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!viewer.dataset) {
      r.emptyChart.hidden = false;
      r.viewLabel.textContent = "等待载入数据";
      r.visiblePoints.textContent = "—";
      r.visibleRange.textContent = "—";
      r.rangeWindow.style.left = "0%";
      r.rangeWindow.style.width = "100%";
      return;
    }
    r.emptyChart.hidden = true;

    const margin = { left: 58, right: 15, top: 16, bottom: 32 };
    const plotW = Math.max(1, width - margin.left - margin.right);
    const plotH = Math.max(1, height - margin.top - margin.bottom);
    const channels = selectedChannels(viewer);
    const start = Math.max(0, Math.floor(viewer.start));
    const end = Math.min(viewer.dataset.sampleCount, Math.ceil(viewer.end));
    const count = Math.max(1, end - start);
    const normalize = r.normalize.checked;
    let yMin = Infinity, yMax = -Infinity;

    if (viewer.yManual) {
      yMin = viewer.yMin;
      yMax = viewer.yMax;
    } else if (channels.length) {
      if (normalize) { yMin = 0; yMax = 1; }
      else {
        for (const channel of channels) {
          const local = rangeMinMax(channel.data, start, Math.min(end, channel.data.length), Math.max(1, Math.floor(count / (plotW * 3))));
          if (local.min < yMin) yMin = local.min;
          if (local.max > yMax) yMax = local.max;
        }
      }
      if (Number.isFinite(yMin) && Number.isFinite(yMax) && !normalize) {
        if (yMin === yMax) { yMin -= .5; yMax += .5; }
        const pad = (yMax - yMin) * .07;
        yMin -= pad; yMax += pad;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin >= yMax) { yMin = 0; yMax = 1; }
    viewer.lastYMin = yMin;
    viewer.lastYMax = yMax;

    drawGrid(ctx, viewer, margin, plotW, plotH, yMin, yMax, start, end);
    const smoothing = Number(r.smooth.value);
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();
    for (const channel of channels) drawChannel(ctx, channel, start, end, margin, plotW, plotH, yMin, yMax, smoothing, normalize);
    ctx.restore();

    const rate = getSampleRate(viewer);
    r.viewLabel.textContent = usesSeconds(viewer)
      ? `时间 ${formatSecondValue(start / rate)} – ${formatSecondValue(Math.max(start, end - 1) / rate)} 秒`
      : `采样点 ${formatInt(start)} – ${formatInt(Math.max(start, end - 1))}`;
    r.visiblePoints.textContent = formatInt(count);
    r.visibleRange.textContent = channels.length ? `${formatNumber(yMin)} – ${formatNumber(yMax)}` : "—";
    updateAxisInputs(viewer, start, end, yMin, yMax);
    updateRangeWindow(viewer);
  }

  function drawGrid(ctx, viewer, margin, plotW, plotH, yMin, yMax, start, end) {
    ctx.lineWidth = 1;
    ctx.font = "12px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = "#637985";
    ctx.strokeStyle = "rgba(63, 91, 103, .14)";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i += 1) {
      const y = margin.top + plotH * i / 5;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
      ctx.fillText(formatNumber(yMax - (yMax - yMin) * i / 5), margin.left - 9, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const rate = getSampleRate(viewer);
    const showSeconds = usesSeconds(viewer);
    for (let i = 0; i <= 6; i += 1) {
      const x = margin.left + plotW * i / 6;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotH); ctx.stroke();
      const index = Math.round(start + (end - start) * i / 6);
      ctx.fillText(showSeconds ? formatSeconds(index / rate) : formatCompact(index), x, margin.top + plotH + 9);
    }
  }

  function drawChannel(ctx, channel, start, end, margin, plotW, plotH, yMin, yMax, smoothing, normalize) {
    const dataEnd = Math.min(end, channel.data.length);
    if (dataEnd <= start) return;
    const span = dataEnd - start;
    const yScale = plotH / (yMax - yMin);
    const transform = (value) => normalize ? (value - channel.min) / Math.max(1e-12, channel.max - channel.min) : value;
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = .9;
    ctx.beginPath();

    if (smoothing > 1) {
      const points = Math.min(Math.floor(plotW), span);
      let started = false;
      for (let px = 0; px < points; px += 1) {
        const center = Math.floor(start + span * px / Math.max(1, points - 1));
        const half = Math.floor(smoothing / 2);
        let sum = 0, valid = 0;
        for (let j = Math.max(start, center - half); j < Math.min(dataEnd, center + half + 1); j += 1) {
          const value = channel.data[j];
          if (Number.isFinite(value)) { sum += value; valid += 1; }
        }
        if (!valid) continue;
        const x = margin.left + plotW * px / Math.max(1, points - 1);
        const y = margin.top + (yMax - transform(sum / valid)) * yScale;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
    } else if (span <= plotW * 2) {
      let started = false;
      for (let i = start; i < dataEnd; i += 1) {
        const value = channel.data[i];
        if (!Number.isFinite(value)) continue;
        const x = margin.left + (i - start) / Math.max(1, span - 1) * plotW;
        const y = margin.top + (yMax - transform(value)) * yScale;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
    } else {
      const bins = Math.max(1, Math.floor(plotW));
      for (let px = 0; px < bins; px += 1) {
        const a = Math.floor(start + span * px / bins);
        const b = Math.max(a + 1, Math.floor(start + span * (px + 1) / bins));
        let low = Infinity, high = -Infinity;
        for (let i = a; i < Math.min(b, dataEnd); i += 1) {
          const value = channel.data[i];
          if (!Number.isFinite(value)) continue;
          if (value < low) low = value;
          if (value > high) high = value;
        }
        if (!Number.isFinite(low)) continue;
        const x = margin.left + px + .5;
        ctx.moveTo(x, margin.top + (yMax - transform(high)) * yScale);
        ctx.lineTo(x, margin.top + (yMax - transform(low)) * yScale);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function rangeMinMax(data, start, end, step) {
    let min = Infinity, max = -Infinity;
    for (let i = start; i < end; i += step) {
      const value = data[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { min, max };
  }

  function updateAxisInputs(viewer, start, end, yMin, yMax) {
    const r = viewer.refs;
    const rate = getSampleRate(viewer);
    const showSeconds = usesSeconds(viewer);
    const forceX = Boolean(viewer.forceXAxisInputs);
    const last = Math.max(0, viewer.dataset.sampleCount - 1);
    r.xMin.min = "0";
    r.xMax.min = showSeconds ? "0" : "1";
    r.xMin.max = showSeconds ? formatAxisInput(last / rate) : String(last);
    r.xMax.max = r.xMin.max;
    r.xMin.step = showSeconds ? "any" : "1";
    r.xMax.step = showSeconds ? "any" : "1";
    if (forceX || document.activeElement !== r.xMin) r.xMin.value = showSeconds ? formatAxisInput(start / rate) : String(start);
    if (forceX || document.activeElement !== r.xMax) r.xMax.value = showSeconds ? formatAxisInput(Math.max(start, end - 1) / rate) : String(Math.max(start, end - 1));
    viewer.forceXAxisInputs = false;
    if (document.activeElement !== r.yMin) r.yMin.value = formatInputNumber(yMin);
    if (document.activeElement !== r.yMax) r.yMax.value = formatInputNumber(yMax);
    [r.xMin, r.xMax, r.yMin, r.yMax].forEach((input) => input.classList.remove("invalid"));
  }

  function updateRangeWindow(viewer) {
    const total = viewer.dataset.sampleCount;
    const left = 100 * viewer.start / total;
    const width = Math.max(.5, 100 * (viewer.end - viewer.start) / total);
    viewer.refs.rangeWindow.style.left = `${Math.max(0, left)}%`;
    viewer.refs.rangeWindow.style.width = `${Math.min(100 - left, width)}%`;
    viewer.refs.rangeWindow.setAttribute("aria-valuemin", "0");
    viewer.refs.rangeWindow.setAttribute("aria-valuemax", String(total - 1));
    const rate = getSampleRate(viewer);
    viewer.refs.rangeWindow.setAttribute("aria-valuetext", usesSeconds(viewer)
      ? `${formatSecondValue(viewer.start / rate)} 到 ${formatSecondValue(Math.max(0, viewer.end - 1) / rate)} 秒`
      : `${Math.floor(viewer.start)} 到 ${Math.max(0, Math.ceil(viewer.end) - 1)}`);
  }

  function setView(viewer, start, end, options = {}) {
    if (!viewer.dataset) return;
    const total = viewer.dataset.sampleCount;
    const minSpan = Math.min(20, total);
    let span = Math.max(minSpan, Math.min(total, end - start));
    let nextStart = start;
    if (nextStart < 0) nextStart = 0;
    if (nextStart + span > total) nextStart = total - span;
    viewer.start = Math.max(0, nextStart);
    viewer.end = Math.min(total, viewer.start + span);

    if (options.sync !== false && app.syncX) {
      const startFraction = viewer.start / total;
      const endFraction = viewer.end / total;
      for (const target of app.viewers) {
        if (target === viewer || !target.dataset) continue;
        setView(target, startFraction * target.dataset.sampleCount, endFraction * target.dataset.sampleCount, { sync: false });
      }
    }
    queueRender(viewer);
  }

  function applyXInputs(viewer, options = {}) {
    if (!viewer.dataset) return;
    const min = Number(viewer.refs.xMin.value);
    const max = Number(viewer.refs.xMax.value);
    const last = viewer.dataset.sampleCount - 1;
    const rate = getSampleRate(viewer);
    const showSeconds = usesSeconds(viewer);
    const displayedLast = showSeconds ? last / rate : last;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > displayedLast + 1e-9 || min >= max) {
      viewer.refs.xMin.classList.add("invalid");
      viewer.refs.xMax.classList.add("invalid");
      if (!options.silent) {
        toast(showSeconds
          ? `X 轴范围应在 0–${formatSecondValue(displayedLast)} 秒内，且下限小于上限`
          : `X 轴范围应在 0–${formatInt(last)} 内，且下限小于上限`, true);
        render(viewer);
      }
      return;
    }
    viewer.refs.xMin.classList.remove("invalid");
    viewer.refs.xMax.classList.remove("invalid");
    setView(viewer,
      Math.floor(showSeconds ? min * rate : min),
      Math.ceil(showSeconds ? max * rate : max) + 1);
  }

  function applyYInputs(viewer, options = {}) {
    if (!viewer.dataset) return;
    const min = Number(viewer.refs.yMin.value);
    const max = Number(viewer.refs.yMax.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      viewer.refs.yMin.classList.add("invalid");
      viewer.refs.yMax.classList.add("invalid");
      if (!options.silent) {
        toast("Y 轴下限必须小于上限", true);
        render(viewer);
      }
      return;
    }
    viewer.refs.yMin.classList.remove("invalid");
    viewer.refs.yMax.classList.remove("invalid");
    viewer.yManual = true;
    viewer.yMin = min;
    viewer.yMax = max;
    render(viewer);
  }

  function resetView(viewer) {
    if (!viewer.dataset) return;
    viewer.yManual = false;
    setView(viewer, 0, viewer.dataset.sampleCount);
  }

  function bindChartInteractions(viewer) {
    const r = viewer.refs;
    r.chartWrap.addEventListener("wheel", (event) => {
      if (!viewer.dataset) return;
      event.preventDefault();
      if (event.altKey) {
        const rect = r.chartWrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top - 16) / Math.max(1, rect.height - 48)));
        const range = viewer.lastYMax - viewer.lastYMin;
        const factor = event.deltaY < 0 ? .8 : 1.25;
        const nextRange = Math.max(1e-12, range * factor);
        const anchor = viewer.lastYMax - ratio * range;
        viewer.yMax = anchor + ratio * nextRange;
        viewer.yMin = viewer.yMax - nextRange;
        viewer.yManual = true;
        queueRender(viewer);
        return;
      }
      const rect = r.chartWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 58) / Math.max(1, rect.width - 73)));
      const span = viewer.end - viewer.start;
      const nextSpan = Math.max(20, Math.min(viewer.dataset.sampleCount, span * (event.deltaY < 0 ? .78 : 1.28)));
      const anchor = viewer.start + span * ratio;
      setView(viewer, anchor - nextSpan * ratio, anchor + nextSpan * (1 - ratio));
    }, { passive: false });

    r.chartWrap.addEventListener("pointerdown", (event) => {
      if (!viewer.dataset || event.button !== 0) return;
      viewer.drag = {
        mode: event.shiftKey ? "y" : "x",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: viewer.start,
        end: viewer.end,
        yMin: viewer.lastYMin,
        yMax: viewer.lastYMax,
      };
      r.chartWrap.classList.add("dragging");
      r.chartWrap.setPointerCapture(event.pointerId);
      r.tooltip.hidden = true;
    });
    r.chartWrap.addEventListener("pointermove", (event) => {
      if (!viewer.drag) { showTooltip(viewer, event); return; }
      const rect = r.chartWrap.getBoundingClientRect();
      if (viewer.drag.mode === "x") {
        const span = viewer.drag.end - viewer.drag.start;
        const shift = -(event.clientX - viewer.drag.x) / Math.max(1, rect.width - 73) * span;
        setView(viewer, viewer.drag.start + shift, viewer.drag.end + shift);
      } else {
        const yRange = viewer.drag.yMax - viewer.drag.yMin;
        const shift = (event.clientY - viewer.drag.y) / Math.max(1, rect.height - 48) * yRange;
        viewer.yMin = viewer.drag.yMin + shift;
        viewer.yMax = viewer.drag.yMax + shift;
        viewer.yManual = true;
        queueRender(viewer);
      }
    });
    const finish = (event) => {
      if (!viewer.drag) return;
      viewer.drag = null;
      r.chartWrap.classList.remove("dragging");
      try { r.chartWrap.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    r.chartWrap.addEventListener("pointerup", finish);
    r.chartWrap.addEventListener("pointercancel", finish);
    r.chartWrap.addEventListener("pointerleave", (event) => {
      if (!viewer.drag) r.tooltip.hidden = true;
      else if (event.buttons === 0) finish(event);
    });
    r.chartWrap.addEventListener("dblclick", () => resetView(viewer));
  }

  function bindRangeInteractions(viewer) {
    const r = viewer.refs;
    r.rangeRail.addEventListener("pointerdown", (event) => {
      if (!viewer.dataset || event.button !== 0) return;
      const rect = r.rangeRail.getBoundingClientRect();
      let action = event.target.dataset.rangeAction;
      if (!action && event.target.closest(".range-window")) action = "move";
      if (!action) {
        const span = viewer.end - viewer.start;
        const center = (event.clientX - rect.left) / rect.width * viewer.dataset.sampleCount;
        setView(viewer, center - span / 2, center + span / 2);
        action = "move";
      }
      viewer.rangeDrag = {
        action,
        pointerId: event.pointerId,
        x: event.clientX,
        start: viewer.start,
        end: viewer.end,
        width: rect.width,
      };
      r.rangeRail.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    r.rangeRail.addEventListener("pointermove", (event) => {
      if (!viewer.rangeDrag || !viewer.dataset) return;
      const drag = viewer.rangeDrag;
      const delta = (event.clientX - drag.x) / Math.max(1, drag.width) * viewer.dataset.sampleCount;
      if (drag.action === "left") setView(viewer, drag.start + delta, drag.end);
      else if (drag.action === "right") setView(viewer, drag.start, drag.end + delta);
      else setView(viewer, drag.start + delta, drag.end + delta);
    });
    const finish = (event) => {
      if (!viewer.rangeDrag) return;
      viewer.rangeDrag = null;
      try { r.rangeRail.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    r.rangeRail.addEventListener("pointerup", finish);
    r.rangeRail.addEventListener("pointercancel", finish);

    [r.rangeWindow, r.rangeLeft, r.rangeRight].forEach((control) => {
      control.addEventListener("keydown", (event) => {
        if (!viewer.dataset || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const step = Math.max(1, Math.round(viewer.dataset.sampleCount * (event.shiftKey ? .05 : .01))) * direction;
        const action = control.dataset.rangeAction || "move";
        if (action === "left") setView(viewer, viewer.start + step, viewer.end);
        else if (action === "right") setView(viewer, viewer.start, viewer.end + step);
        else setView(viewer, viewer.start + step, viewer.end + step);
      });
    });
  }

  function showTooltip(viewer, event) {
    if (!viewer.dataset) return;
    const r = viewer.refs;
    const rect = r.chartWrap.getBoundingClientRect();
    const plotW = rect.width - 73;
    const x = event.clientX - rect.left;
    if (x < 58 || x > rect.width - 15) { r.tooltip.hidden = true; return; }
    const index = Math.max(0, Math.min(viewer.dataset.sampleCount - 1, Math.round(viewer.start + (x - 58) / plotW * (viewer.end - viewer.start))));
    const rate = getSampleRate(viewer);
    const rows = selectedChannels(viewer).slice(0, 8).map((channel) =>
      `<div class="tooltip-line"><span><i style="background:${channel.color}"></i>${escapeHtml(channel.name)}</span><b>${formatNumber(channel.data[index])}</b></div>`
    ).join("");
    r.tooltip.innerHTML = `<strong>${usesSeconds(viewer) ? `${formatSecondValue(index / rate)} 秒 · 点 ${formatInt(index)}` : `采样点 ${formatInt(index)}`}</strong>${rows}`;
    r.tooltip.hidden = false;
    const tipX = x > rect.width * .65 ? x - r.tooltip.offsetWidth - 12 : x + 12;
    r.tooltip.style.left = `${Math.max(7, tipX)}px`;
    r.tooltip.style.top = `${Math.max(7, event.clientY - rect.top - r.tooltip.offsetHeight - 7)}px`;
  }

  function toggleExpanded(viewer) {
    const r = viewer.refs;
    const expanded = !r.chartPanel.classList.contains("chart-expanded");
    for (const item of app.viewers) {
      if (item !== viewer) {
        item.refs.chartPanel.classList.remove("chart-expanded");
        item.refs.expand.setAttribute("aria-pressed", "false");
        item.refs.expand.setAttribute("aria-label", "放大图表");
      }
    }
    r.chartPanel.classList.toggle("chart-expanded", expanded);
    document.body.classList.toggle("chart-focus", expanded);
    r.expand.setAttribute("aria-pressed", String(expanded));
    r.expand.setAttribute("aria-label", expanded ? "退出放大" : "放大图表");
    r.expand.querySelector("span").textContent = expanded ? "退出" : "放大";
    setTimeout(() => render(viewer), 0);
  }

  async function loadFile(viewer, file) {
    if (!file || !/\.tdms$/i.test(file.name)) { toast("请选择 .tdms 文件", true); return; }
    setBusy(viewer, true, "正在读取文件", `${file.name} · ${formatBytes(file.size)}`);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const buffer = await file.arrayBuffer();
      setBusy(viewer, true, "正在解析波形", "识别通道与采样数据…");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const dataset = window.TdmsParser.parse(buffer, file.name);
      setDataset(viewer, dataset);
      const index = app.viewers.indexOf(viewer) + 1;
      toast(`观察器 ${index} 已载入 ${dataset.channels.length} 个通道`);
    } catch (error) {
      console.error(error);
      toast(error?.message || "无法读取这个 TDMS 文件", true);
    } finally {
      setBusy(viewer, false);
      viewer.refs.fileInput.value = "";
    }
  }

  async function exportCsv(viewer) {
    if (!viewer.dataset) { toast("请先载入 TDMS 文件", true); return; }
    const channels = selectedChannels(viewer);
    if (!channels.length) { toast("请至少选择一个通道", true); return; }
    const visible = viewer.refs.exportScope.value === "visible";
    const start = visible ? Math.max(0, Math.floor(viewer.start)) : 0;
    const end = visible ? Math.min(viewer.dataset.sampleCount, Math.ceil(viewer.end)) : viewer.dataset.sampleCount;
    const rate = Number(viewer.refs.sampleRate.value);
    viewer.refs.exportButton.disabled = true;
    setBusy(viewer, true, "正在生成 CSV", `${formatInt(end - start)} 行 · ${channels.length} 个通道`);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const blobs = ["\uFEFF", [rate > 0 ? "Time_s" : "Sample", ...channels.map((channel) => csvCell(channel.name))].join(",") + "\r\n"];
      const batch = 5000;
      for (let from = start; from < end; from += batch) {
        const rows = [];
        const to = Math.min(end, from + batch);
        for (let i = from; i < to; i += 1) {
          const first = rate > 0 ? (i / rate).toFixed(9).replace(/0+$/, "").replace(/\.$/, "") : String(i);
          const row = [first];
          for (const channel of channels) row.push(i < channel.data.length && Number.isFinite(channel.data[i]) ? String(channel.data[i]) : "");
          rows.push(row.join(","));
        }
        blobs.push(rows.join("\r\n") + "\r\n");
        if ((from - start) % (batch * 8) === 0) {
          viewer.refs.statusText.textContent = `${Math.round(100 * (to - start) / Math.max(1, end - start))}%`;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      const blob = new Blob(blobs, { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const base = viewer.dataset.fileName.replace(/\.tdms$/i, "").replace(/[\\/:*?\"<>|]/g, "_");
      anchor.href = url;
      anchor.download = `${base}${visible ? "_visible" : ""}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast("CSV 已开始下载");
    } catch (error) {
      console.error(error);
      toast("CSV 导出失败，请缩小视窗后重试", true);
    } finally {
      viewer.refs.exportButton.disabled = false;
      setBusy(viewer, false);
    }
  }

  function setBusy(viewer, active, title = "", text = "") {
    viewer.refs.statusBar.hidden = !active;
    if (active) {
      viewer.refs.statusTitle.textContent = title;
      viewer.refs.statusText.textContent = text;
    }
  }

  function toast(message, error = false) {
    clearTimeout(app.toastTimer);
    toastElement.textContent = message;
    toastElement.classList.toggle("error", error);
    toastElement.classList.add("show");
    app.toastTimer = setTimeout(() => toastElement.classList.remove("show"), 3200);
  }

  function formatInt(value) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value); }
  function formatNumber(value) {
    if (!Number.isFinite(value)) return "—";
    const absolute = Math.abs(value);
    if ((absolute > 0 && absolute < .001) || absolute >= 100000) return value.toExponential(3);
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: absolute < 10 ? 4 : 2 }).format(value);
  }
  function formatInputNumber(value) {
    if (!Number.isFinite(value)) return "";
    return Number(value.toPrecision(8)).toString();
  }
  function getSampleRate(viewer) {
    const rate = Number(viewer.refs.sampleRate.value);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  }
  function usesSeconds(viewer) { return viewer.refs.xUnit.value === "seconds" && getSampleRate(viewer) > 0; }
  function formatAxisInput(value) {
    if (!Number.isFinite(value)) return "";
    return Number(value.toPrecision(10)).toString();
  }
  function formatCompact(value) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
  function formatSecondValue(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const absolute = Math.abs(seconds);
    const digits = absolute < 1 ? 4 : absolute < 10 ? 3 : absolute < 100 ? 2 : absolute < 1000 ? 1 : 0;
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(seconds);
  }
  function formatSeconds(seconds) { return `${formatSecondValue(seconds)} s`; }
  function formatBytes(bytes) { return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function csvCell(value) { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const report = (error) => console.warn("WebMCP tool registration failed", error);
    try {
      void Promise.resolve(context.registerTool({
        name: "configure_waveform_display",
        title: "设置波形观察器",
        description: "按序号设置一个波形观察器的显示参数和坐标轴范围。",
        inputSchema: {
          type: "object",
          properties: {
            viewerIndex: { type: "integer", minimum: 1 },
            sampleRateHz: { type: "number", exclusiveMinimum: 0 },
            xAxisUnit: { type: "string", enum: ["samples", "seconds"] },
            smoothingPoints: { type: "integer", enum: [1, 5, 20, 100] },
            normalize: { type: "boolean" },
            xMin: { type: "number", minimum: 0 },
            xMax: { type: "number", exclusiveMinimum: 0 },
            yMin: { type: "number" },
            yMax: { type: "number" },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object") throw new Error("设置必须是对象");
          const viewer = app.viewers[(input.viewerIndex || 1) - 1];
          if (!viewer?.dataset) throw new Error("指定观察器尚未载入数据");
          if (input.sampleRateHz !== undefined) {
            if (!Number.isFinite(input.sampleRateHz) || input.sampleRateHz <= 0) throw new Error("采样频率必须大于 0");
            viewer.refs.sampleRate.value = String(input.sampleRateHz);
          }
          if (input.xAxisUnit !== undefined) {
            if (!['samples', 'seconds'].includes(input.xAxisUnit)) throw new Error("xAxisUnit 仅支持 samples 或 seconds");
            if (input.xAxisUnit === "seconds" && !getSampleRate(viewer)) throw new Error("使用 seconds 前必须设置采样频率");
            viewer.refs.xUnit.value = input.xAxisUnit;
            viewer.forceXAxisInputs = true;
          }
          if (input.smoothingPoints !== undefined) {
            if (![1, 5, 20, 100].includes(input.smoothingPoints)) throw new Error("平滑点数仅支持 1、5、20 或 100");
            viewer.refs.smooth.value = String(input.smoothingPoints);
          }
          if (input.normalize !== undefined) {
            if (typeof input.normalize !== "boolean") throw new Error("normalize 必须是布尔值");
            viewer.refs.normalize.checked = input.normalize;
            viewer.yManual = false;
          }
          if (input.xMin !== undefined || input.xMax !== undefined) {
            viewer.refs.xMin.value = String(input.xMin ?? viewer.refs.xMin.value);
            viewer.refs.xMax.value = String(input.xMax ?? viewer.refs.xMax.value);
            applyXInputs(viewer);
          }
          if (input.yMin !== undefined || input.yMax !== undefined) {
            if (!Number.isFinite(input.yMin) || !Number.isFinite(input.yMax) || input.yMin >= input.yMax) throw new Error("必须同时提供有效的 yMin 和 yMax");
            viewer.yManual = true; viewer.yMin = input.yMin; viewer.yMax = input.yMax;
          }
          render(viewer);
          return { viewerIndex: app.viewers.indexOf(viewer) + 1, xMin: Math.floor(viewer.start), xMax: Math.ceil(viewer.end) - 1, yMin: viewer.lastYMin, yMax: viewer.lastYMax };
        },
      })).catch(report);
      void Promise.resolve(context.registerTool({
        name: "set_waveform_workspace",
        title: "设置观察工作区",
        description: "设置每行观察器数量和是否同步多个观察器的 X 轴。",
        inputSchema: {
          type: "object",
          properties: { columns: { type: "integer", minimum: 1, maximum: 3 }, syncX: { type: "boolean" } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (input.columns !== undefined) setColumns(input.columns);
          if (input.syncX !== undefined) { app.syncX = Boolean(input.syncX); syncXToggle.checked = app.syncX; }
          return { columns: app.columns, syncX: app.syncX, viewerCount: app.viewers.length };
        },
      })).catch(report);
      void Promise.resolve(context.registerTool({
        name: "reset_waveform_view",
        title: "复位波形视图",
        description: "按序号把一个波形观察器恢复到全部采样点和自动 Y 轴。",
        inputSchema: { type: "object", properties: { viewerIndex: { type: "integer", minimum: 1 } }, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const viewer = app.viewers[((input && input.viewerIndex) || 1) - 1];
          if (!viewer?.dataset) throw new Error("指定观察器尚未载入数据");
          resetView(viewer);
          return { viewerIndex: app.viewers.indexOf(viewer) + 1, startSample: 0, endSample: viewer.dataset.sampleCount - 1 };
        },
      })).catch(report);
    } catch (error) { report(error); }
  }

  addViewerButton.addEventListener("click", () => {
    const viewer = createViewer();
    if (viewer) viewer.element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  columnSelect.addEventListener("change", () => setColumns(columnSelect.value));
  syncXToggle.addEventListener("change", () => {
    app.syncX = syncXToggle.checked;
    if (app.syncX) {
      const source = app.viewers.find((viewer) => viewer.dataset);
      if (source) setView(source, source.start, source.end);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const expanded = app.viewers.find((viewer) => viewer.refs.chartPanel.classList.contains("chart-expanded"));
    if (expanded) toggleExpanded(expanded);
  });

  let savedColumns = 2;
  try { savedColumns = Number(localStorage.getItem("tdms-viewer-columns")) || 2; } catch (_) {}
  setColumns(savedColumns);
  createViewer({ demo: true });
  createViewer();
  updateViewerLabels();
  registerWebMcpTools();
})();
