const {
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
} = require("obsidian");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

// ==========================================
// 1. PURE-REF PARSER
// ==========================================
const PURVIEW_VERSION = "1.2.0";
const GRAPHICS_IMAGE_ITEM = 34;
const GRAPHICS_TEXT_ITEM = 32;
const PNG_HEAD = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_FOOT = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

function defaultPureRefPath() {
  if (process.platform === "darwin") {
    return "/Applications/PureRef.app/Contents/MacOS/PureRef";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\PureRef\\PureRef.exe";
  }
  return "";
}

function resolveVaultFilePath(plugin, file) {
  const adapter = plugin.app.vault.adapter;
  if (typeof adapter.getFullPath === "function") {
    return adapter.getFullPath(file.path);
  }
  return path.join(adapter.basePath, file.path);
}

function isPureRefInstalled(pureRefPath) {
  if (pureRefPath && fs.existsSync(pureRefPath)) return true;
  if (process.platform === "darwin") {
    return fs.existsSync("/Applications/PureRef.app");
  }
  if (process.platform === "win32" && pureRefPath) {
    return fs.existsSync(pureRefPath);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPureRefCommands(purPath, outPath, pureRefPath, exportMaxSize) {
  const commands = [
    `load;${purPath}`,
    `exportScene;${outPath};${exportMaxSize};${exportMaxSize};true;true;true`,
    "exit",
  ];

  if (process.platform === "darwin" && fs.existsSync("/Applications/PureRef.app")) {
    const args = ["-a", "PureRef", "--args"];
    for (const command of commands) {
      args.push("-c", command);
    }
    await execFileAsync("open", args, { timeout: 120000 });
    return;
  }

  if (!pureRefPath || !fs.existsSync(pureRefPath)) {
    throw new Error("PureRef executable not found");
  }

  const args = [];
  for (const command of commands) {
    args.push("-c", command);
  }
  await execFileAsync(pureRefPath, args, { timeout: 120000 });
}

async function exportViaPureRef(purPath, pureRefPath, exportMaxSize = 4000) {
  if (!isPureRefInstalled(pureRefPath)) return null;
  const outPath = path.join(
    os.tmpdir(),
    `purview-export-${process.pid}-${Date.now()}.png`,
  );
  try {
    await runPureRefCommands(purPath, outPath, pureRefPath, exportMaxSize);
    for (let attempt = 0; attempt < 60 && !fs.existsSync(outPath); attempt++) {
      await sleep(500);
    }
    if (!fs.existsSync(outPath)) return null;
    const imageBytes = new Uint8Array(fs.readFileSync(outPath));
    fs.unlinkSync(outPath);
    if (imageBytes.length < 128) return null;
    const mimeType = detectImageMime(imageBytes);
    const dims = imageDimsFromBytes(imageBytes, mimeType);
    const w = dims.w || exportMaxSize;
    const h = dims.h || exportMaxSize;
    return {
      version: "v2-export",
      canvas: [0, 0, w, h],
      zoom: 1,
      xCanvas: 0,
      yCanvas: 0,
      folderLocation: "",
      images: [
        {
          imageBytes,
          mimeType,
          transforms: [
            {
              type: "image",
              id: 0,
              zLayer: 1,
              matrix: [1, 0, 0, 1],
              x: w / 2,
              y: h / 2,
              points: [
                [-w / 2, w / 2],
                [-h / 2, h / 2],
              ],
              textChildren: [],
            },
          ],
        },
      ],
      text: [],
    };
  } catch (err) {
    try {
      fs.unlinkSync(outPath);
    } catch (_) {
      // ignore cleanup errors
    }
    console.warn("PurView: PureRef export failed", err);
    return null;
  }
}

function detectPurVersion(bytes) {
  if (bytes.length < 12) return "unknown";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0, false);
  let version = "";
  for (let i = 4; i < 12; i += 2) {
    const code = view.getUint16(i, false);
    if (code === 0) break;
    version += String.fromCharCode(code);
  }
  if (signature === 8 && version.startsWith("1.")) return "v1";
  if (signature === 6 && version.startsWith("2.")) return "v2";
  return "unknown";
}

function detectImageMime(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  return "application/octet-stream";
}

function imageDimsFromBytes(imageBytes, mimeType) {
  if (mimeType === "image/png" && imageBytes.length >= 24) {
    const dv = new DataView(
      imageBytes.buffer,
      imageBytes.byteOffset,
      imageBytes.byteLength,
    );
    return { w: dv.getUint32(16, false), h: dv.getUint32(20, false) };
  }
  if (
    mimeType === "image/jpeg" &&
    imageBytes.length > 4 &&
    imageBytes[0] === 0xff &&
    imageBytes[1] === 0xd8
  ) {
    let i = 2;
    while (i < imageBytes.length - 8) {
      if (imageBytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = imageBytes[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          h: (imageBytes[i + 5] << 8) | imageBytes[i + 6],
          w: (imageBytes[i + 7] << 8) | imageBytes[i + 8],
        };
      }
      const segLen = (imageBytes[i + 2] << 8) | imageBytes[i + 3];
      i += 2 + segLen;
    }
  }
  return { w: 0, h: 0 };
}

function hsvToRgbUnit(h, s, v) {
  if (s === 0) return [v, v, v];
  let i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  i = ((i % 6) + 6) % 6;
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function hsv16ToRgb16(hsv) {
  const [r, g, b] = hsvToRgbUnit(
    hsv[0] / 35900,
    hsv[1] / 65535,
    hsv[2] / 65535,
  );
  return [Math.round(r * 65535), Math.round(g * 65535), Math.round(b * 65535)];
}

function findSequence(bytes, seq, from) {
  const n = bytes.length,
    m = seq.length;
  outer: for (let i = from; i <= n - m; i++) {
    for (let j = 0; j < m; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseV1(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let pos = 0;
  const erase = (n) => {
    pos += n;
  };

  const u16 = (rel = 0) => view.getUint16(pos + rel, false);
  const u32 = (rel = 0) => view.getUint32(pos + rel, false);
  const i32 = (rel = 0) => view.getInt32(pos + rel, false);
  const u64 = (rel = 0) => Number(view.getBigUint64(pos + rel, false));
  const f64 = (rel = 0) => view.getFloat64(pos + rel, false);

  const readEraseU32 = () => {
    const v = u32(0);
    erase(4);
    return v;
  };
  const readEraseU16 = () => {
    const v = u16(0);
    erase(2);
    return v;
  };
  const readEraseI8 = () => {
    const v = view.getInt8(pos);
    erase(1);
    return v;
  };
  const readEraseF64 = () => {
    const v = f64(0);
    erase(8);
    return v;
  };

  function readEraseMatrix() {
    const m = [f64(0), f64(8), f64(24), f64(32)];
    erase(48);
    return m;
  }

  function readEraseRGB() {
    return [readEraseU16(), readEraseU16(), readEraseU16()];
  }

  function readEraseString() {
    const len = readEraseU32();
    let s = "";
    for (let i = 0; i < len; i += 2)
      s += String.fromCharCode(view.getUint16(pos + i, false));
    erase(len);
    return s;
  }

  function findRelative(seq) {
    const idx = findSequence(bytes, seq, pos);
    return idx === -1 ? -1 : idx - pos;
  }

  function readHeader() {
    const canvas = [
      view.getFloat64(112, false),
      view.getFloat64(120, false),
      view.getFloat64(128, false),
      view.getFloat64(136, false),
    ];
    const zoom = view.getFloat64(144, false);
    const xCanvas = view.getInt32(216, false);
    const yCanvas = view.getInt32(220, false);
    erase(224);
    return { canvas, zoom, xCanvas, yCanvas };
  }

  const images = [];
  function readImages() {
    while (true) {
      const start = findRelative(PNG_HEAD);
      if (start === -1) break;
      const footAt = findRelative(PNG_FOOT);
      const end = footAt + 12;

      if (start >= 4) {
        images.push({
          address: [pos, pos + 4],
          imageBytes: bytes.slice(pos, pos + 4),
          mimeType: "image/png",
          transforms: [],
        });
        erase(4);
      } else {
        images.push({
          address: [pos + start, pos + end],
          imageBytes: bytes.slice(pos + start, pos + end),
          mimeType: "image/png",
          transforms: [],
        });
        erase(end);
      }
    }
    while (u32(8) !== GRAPHICS_IMAGE_ITEM && u32(8) !== GRAPHICS_TEXT_ITEM) {
      images.push({
        address: [pos, pos + 4],
        imageBytes: bytes.slice(pos, pos + 4),
        mimeType: "image/png",
        transforms: [],
      });
      erase(4);
    }
  }

  const imageItems = [];
  const textItems = [];

  function addTextChildren(parent, n) {
    for (let i = 0; i < n; i++)
      parent.textChildren.push(readGraphicsTextItem());
  }

  function readGraphicsTextItem() {
    const transformEnd = u64(0);
    erase(12 + u32(8));
    const item = {
      type: "text",
      id: 0,
      zLayer: 1.0,
      matrix: [1, 0, 0, 1],
      x: 0,
      y: 0,
      text: "",
      opacity: 65535,
      rgb: [65535, 65535, 65535],
      opacityBackground: 5000,
      rgbBackground: [0, 0, 0],
      textChildren: [],
    };
    item.text = readEraseString();
    item.matrix = readEraseMatrix();
    item.x = readEraseF64();
    item.y = readEraseF64();
    erase(8);
    item.id = readEraseU32();
    item.zLayer = readEraseF64();
    let isHsv = readEraseI8() === 2;
    item.opacity = readEraseU16();
    item.rgb = readEraseRGB();
    if (isHsv) item.rgb = hsv16ToRgb16(item.rgb);
    erase(2);
    isHsv = readEraseI8() === 2;
    item.opacityBackground = readEraseU16();
    item.rgbBackground = readEraseRGB();
    if (isHsv) item.rgbBackground = hsv16ToRgb16(item.rgbBackground);
    const numChildren = u32(2);
    erase(transformEnd - pos);
    if (numChildren > 0) addTextChildren(item, numChildren);
    return item;
  }

  function readGraphicsImageItem() {
    const transformEnd = u64(0);
    erase(12 + u32(8));
    const item = {
      type: "image",
      id: 0,
      zLayer: 1.0,
      matrix: [1, 0, 0, 1],
      x: 0,
      y: 0,
      source: "BruteForceLoaded",
      name: "image",
      matrixBeforeCrop: [1, 0, 0, 1],
      xCrop: 0,
      yCrop: 0,
      scaleCrop: 1,
      points: [[], []],
      textChildren: [],
    };
    let bruteForceLoaded = false;
    if (u32(0) === 0) {
      bruteForceLoaded = true;
      erase(4);
    }
    if (i32(0) === -1) erase(4);
    else item.source = readEraseString();
    if (!bruteForceLoaded) {
      if (i32(0) === -1) erase(4);
      else item.name = readEraseString();
    }
    erase(8);
    item.matrix = readEraseMatrix();
    item.x = readEraseF64();
    item.y = readEraseF64();
    erase(8);
    item.id = readEraseU32();
    item.zLayer = readEraseF64();
    item.matrixBeforeCrop = readEraseMatrix();
    item.xCrop = readEraseF64();
    item.yCrop = readEraseF64();
    item.scaleCrop = readEraseF64();
    const pointCount = readEraseU32();
    item.points = [[], []];
    for (let i = 0; i < pointCount; i++) {
      erase(4);
      item.points[0].push(readEraseF64());
      item.points[1].push(readEraseF64());
    }
    const numChildren = u32(21);
    erase(transformEnd - pos);
    addTextChildren(item, numChildren);
    return item;
  }

  function readItems() {
    while (u32(8) === GRAPHICS_IMAGE_ITEM || u32(8) === GRAPHICS_TEXT_ITEM) {
      if (u32(8) === GRAPHICS_IMAGE_ITEM)
        imageItems.push(readGraphicsImageItem());
      else textItems.push(readGraphicsTextItem());
    }
  }

  const header = readHeader();
  readImages();
  readItems();
  const folderLocation = readEraseString();

  for (let k = 0; k < imageItems.length; k++) {
    const redId = u32(0);
    const refAddress0 = u64(4);
    for (const it of imageItems) {
      if (it.id === redId) {
        for (const img of images) {
          if (refAddress0 === img.address[0]) img.transforms = [it];
        }
      }
    }
    erase(20);
  }

  function isDuplicateMarker(img) {
    if (img.imageBytes.length !== 4) return false;
    return !(
      img.imageBytes[0] === 0xff &&
      img.imageBytes[1] === 0xff &&
      img.imageBytes[2] === 0xff &&
      img.imageBytes[3] === 0xff
    );
  }

  for (const img of images) {
    if (isDuplicateMarker(img)) {
      const targetId =
        ((img.imageBytes[0] << 24) |
          (img.imageBytes[1] << 16) |
          (img.imageBytes[2] << 8) |
          img.imageBytes[3]) >>>
        0;
      for (const other of images) {
        if (other.transforms.length && other.transforms[0].id === targetId) {
          other.transforms = other.transforms.concat(img.transforms);
        }
      }
    }
  }

  return {
    version: "v1",
    canvas: header.canvas,
    zoom: header.zoom,
    xCanvas: header.xCanvas,
    yCanvas: header.yCanvas,
    folderLocation,
    images: images.filter((img) => !isDuplicateMarker(img)),
    text: textItems,
  };
}

async function parseV2(_arrayBuffer, plugin, file) {
  const pureRefPath = plugin?.settings?.pureRefPath || defaultPureRefPath();
  if (!isPureRefInstalled(pureRefPath)) {
    throw new Error(
      "PureRef 2.x boards require PureRef to be installed. Get it at https://www.pureref.com",
    );
  }
  if (!file) {
    throw new Error("Could not resolve the .pur file path for PureRef export.");
  }

  const purPath = resolveVaultFilePath(plugin, file);
  console.info(`PurView ${PURVIEW_VERSION}: exporting via PureRef`, purPath);
  const exported = await exportViaPureRef(purPath, pureRefPath);
  if (exported) {
    console.info(`PurView ${PURVIEW_VERSION}: rendered via PureRef export`);
    return exported;
  }
  throw new Error(
    "PureRef could not export this board. Check the developer console for details.",
  );
}

const PureRefParser = {
  async parse(arrayBuffer, plugin, file) {
    const bytes = new Uint8Array(arrayBuffer);
    const version = detectPurVersion(bytes);
    if (version === "v2") return parseV2(arrayBuffer, plugin, file);
    if (version === "v1") return parseV1(arrayBuffer);
    throw new Error(
      "Unsupported .pur file. PurView supports PureRef 1.10/1.11.1 and 2.x boards.",
    );
  },
};

// ==========================================
// 2. PLUGIN LOGIC & SETTINGS
// ==========================================
const VIEW_TYPE_PURVIEW = "pureview-view";

const DEFAULT_SETTINGS = {
  matchThemeBackground: true,
  openInNewTab: true,
  pureRefPath: "",
};

class PureViewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.bounds = null;
    this.hasFitted = false;
    this.pendingFile = null;
  }

  getViewType() {
    return VIEW_TYPE_PURVIEW;
  }
  getDisplayText() {
    return this.file ? this.file.basename : "PurView";
  }
  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("pureview-container");
    this.updateThemeClass();

    container.innerHTML = `
            <div id="viewport">
                <div id="world"></div>
            </div>
        `;
    this.setupViewer();

    if (this.pendingFile) {
      const file = this.pendingFile;
      this.pendingFile = null;
      await this.setFileData(file);
    }
  }

  async onClose() {
    if (this.resizeObserver && this.els && this.els.viewport) {
      this.resizeObserver.unobserve(this.els.viewport);
      this.resizeObserver.disconnect();
    }
  }

  updateThemeClass() {
    if (this.plugin.settings.matchThemeBackground) {
      this.containerEl.children[1]?.addClass("match-theme");
    } else {
      this.containerEl.children[1]?.removeClass("match-theme");
    }
  }

  setupViewer() {
    const els = {
      viewport: this.containerEl.querySelector("#viewport"),
      world: this.containerEl.querySelector("#world"),
    };
    this.els = els;

    const view = { x: 0, y: 0, scale: 1 };

    const applyView = () => {
      els.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    };

    this.fitToBounds = () => {
      if (!this.bounds) return;
      const vw = els.viewport.clientWidth,
        vh = els.viewport.clientHeight;
      if (vw === 0 || vh === 0) return;

      const bw = Math.max(1, this.bounds.maxX - this.bounds.minX);
      const bh = Math.max(1, this.bounds.maxY - this.bounds.minY);
      const pad = 60;
      const scale = Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh, 4);
      view.scale = scale > 0 ? scale : 1;
      const cx = (this.bounds.minX + this.bounds.maxX) / 2;
      const cy = (this.bounds.minY + this.bounds.maxY) / 2;
      view.x = vw / 2 - cx * view.scale;
      view.y = vh / 2 - cy * view.scale;
      applyView();
    };

    this.resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (
          entry.contentRect.width > 0 &&
          entry.contentRect.height > 0 &&
          !this.hasFitted &&
          this.bounds
        ) {
          this.fitToBounds();
          this.hasFitted = true;
        }
      }
    });
    this.resizeObserver.observe(els.viewport);

    let dragging = false,
      dragStart = null;
    els.viewport.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStart = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      els.viewport.classList.add("dragging");
      els.viewport.setPointerCapture(e.pointerId);
    });
    els.viewport.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      view.x = dragStart.vx + (e.clientX - dragStart.px);
      view.y = dragStart.vy + (e.clientY - dragStart.py);
      applyView();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      els.viewport.addEventListener(ev, () => {
        dragging = false;
        els.viewport.classList.remove("dragging");
      }),
    );
    els.viewport.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const absX = Math.abs(e.deltaX);
        const absY = Math.abs(e.deltaY);

        if (!e.ctrlKey && absX > absY) {
          view.x -= e.deltaX;
          applyView();
          return;
        }

        const rect = els.viewport.getBoundingClientRect();
        const mx = e.clientX - rect.left,
          my = e.clientY - rect.top;
        const worldXBefore = (mx - view.x) / view.scale;
        const worldYBefore = (my - view.y) / view.scale;
        const factor = Math.exp(-e.deltaY * 0.0016);
        view.scale = Math.min(20, Math.max(0.02, view.scale * factor));
        view.x = mx - worldXBefore * view.scale;
        view.y = my - worldYBefore * view.scale;
        applyView();
      },
      { passive: false },
    );
  }

  showError(message) {
    if (!this.els || !this.els.world) return;
    this.els.world.innerHTML = `<div class="pureview-error">${message}</div>`;
    this.bounds = null;
  }

  async setFileData(file) {
    this.file = file;
    this.leaf.tabHeaderInnerTitleEl?.setText(file.basename);
    const headerTitleEl =
      this.containerEl.children[0]?.querySelector(".view-header-title");
    if (headerTitleEl) headerTitleEl.textContent = file.basename;

    if (!this.els || !this.els.world) {
      this.pendingFile = file;
      return;
    }

    const arrayBuffer = await this.app.vault.readBinary(file);
    const version = detectPurVersion(new Uint8Array(arrayBuffer));
    let loadingNotice = null;
    if (version === "v2") {
      loadingNotice = new Notice("PurView: rendering board...", 0);
    }
    try {
      const board = await PureRefParser.parse(arrayBuffer, this.plugin, file);
      loadingNotice?.hide();
      this.renderBoard(board);
    } catch (err) {
      loadingNotice?.hide();
      console.error(err);
      this.showError(
        `Could not open ${file.basename}. ${err?.message || "Unknown error."}`,
      );
      new Notice(`PurView: failed to open ${file.basename}`);
    }
  }

  renderBoard(board) {
    const world = this.els.world;
    world.innerHTML = "";
    const b = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    const jobs = [];

    function imageDims(imageBytes, mimeType) {
      if (mimeType === "image/png" && imageBytes.length >= 24) {
        const dv = new DataView(
          imageBytes.buffer,
          imageBytes.byteOffset,
          imageBytes.byteLength,
        );
        return { w: dv.getUint32(16, false), h: dv.getUint32(20, false) };
      }
      return { w: 0, h: 0 };
    }
    function bbox(points) {
      return { min: Math.min(...points), max: Math.max(...points) };
    }
    function expandBounds(bx, x0, y0, x1, y1) {
      bx.minX = Math.min(bx.minX, x0, x1);
      bx.maxX = Math.max(bx.maxX, x0, x1);
      bx.minY = Math.min(bx.minY, y0, y1);
      bx.maxY = Math.max(bx.maxY, y0, y1);
    }
    function el(tag, cls) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    }

    function renderImageTransform(w, image, transform, bx) {
      const dims = imageDims(image.imageBytes, image.mimeType);
      const nx = bbox(
        transform.points[0] && transform.points[0].length
          ? transform.points[0]
          : [-dims.w / 2, dims.w / 2],
      );
      const ny = bbox(
        transform.points[1] && transform.points[1].length
          ? transform.points[1]
          : [-dims.h / 2, dims.h / 2],
      );
      const cropW = Math.max(1, nx.max - nx.min);
      const cropH = Math.max(1, ny.max - ny.min);

      const [a, bM, c, d] = transform.matrix;
      const anchor = el("div", "pur-anchor");
      anchor.style.transform = `matrix(${a}, ${bM}, ${c}, ${d}, ${transform.x}, ${transform.y})`;

      const cropDiv = el("div", "pur-centered pur-image-crop");
      cropDiv.style.width = cropW + "px";
      cropDiv.style.height = cropH + "px";

      if (!image._blobUrl) {
        image._blobUrl = URL.createObjectURL(
          new Blob([image.imageBytes], { type: image.mimeType }),
        );
      }
      const img = el("img");
      img.src = image._blobUrl;
      if (dims.w > 0 && dims.h > 0) {
        img.style.width = dims.w + "px";
        img.style.height = dims.h + "px";
        img.style.left = -(nx.min + dims.w / 2) + "px";
        img.style.top = -(ny.min + dims.h / 2) + "px";
      } else {
        img.style.maxWidth = cropW + "px";
        img.style.maxHeight = cropH + "px";
        img.style.left = "0";
        img.style.top = "0";
      }
      img.draggable = false;

      cropDiv.appendChild(img);
      anchor.appendChild(cropDiv);
      w.appendChild(anchor);

      const hw = cropW / 2,
        hh = cropH / 2;
      const corners = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ].map(([px, py]) => [
        a * px + c * py + transform.x,
        bM * px + d * py + transform.y,
      ]);
      for (const [wx, wy] of corners) expandBounds(bx, wx, wy, wx, wy);
    }

    function rgb16(rgb) {
      return rgb.map((v) => Math.round((v / 65535) * 255));
    }

    function renderText(w, item, bx) {
      const [a, bM, c, d] = item.matrix;
      const anchor = el("div", "pur-anchor");
      anchor.style.transform = `matrix(${a}, ${bM}, ${c}, ${d}, ${item.x}, ${item.y})`;
      const box = el("div", "pur-centered pur-text");
      const fg = rgb16(item.rgb);
      const bg = rgb16(item.rgbBackground);
      box.style.color = `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${item.opacity / 65535})`;
      box.style.background = `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, ${item.opacityBackground / 65535})`;
      box.textContent = item.text || "";
      anchor.appendChild(box);
      w.appendChild(anchor);
      expandBounds(bx, item.x - 100, item.y - 20, item.x + 100, item.y + 20);
    }

    function collectAllText(list, out) {
      for (const t of list) {
        out.push(t);
        if (t.textChildren && t.textChildren.length)
          collectAllText(t.textChildren, out);
      }
    }

    for (const image of board.images) {
      for (const transform of image.transforms) {
        jobs.push({
          z: transform.zLayer,
          run: () => renderImageTransform(world, image, transform, b),
        });
        if (transform.textChildren && transform.textChildren.length) {
          const kids = [];
          collectAllText(transform.textChildren, kids);
          kids.forEach((t) =>
            jobs.push({ z: t.zLayer, run: () => renderText(world, t, b) }),
          );
        }
      }
    }
    const topText = [];
    collectAllText(board.text, topText);
    topText.forEach((t) =>
      jobs.push({ z: t.zLayer, run: () => renderText(world, t, b) }),
    );

    jobs.sort((j1, j2) => j1.z - j2.z);
    jobs.forEach((j) => j.run());

    if (!isFinite(b.minX)) {
      b.minX = 0;
      b.minY = 0;
      b.maxX = 100;
      b.maxY = 100;
    }

    this.bounds = b;
    this.hasFitted = false;

    if (
      this.els.viewport.clientWidth > 0 &&
      this.els.viewport.clientHeight > 0
    ) {
      this.fitToBounds();
      this.hasFitted = true;
    }
  }

  getState() {
    const state = super.getState();
    if (this.file) {
      state.file = this.file.path;
    }
    return state;
  }

  async setState(state, result) {
    if (state.file) {
      const file = this.app.vault.getAbstractFileByPath(state.file);
      if (file instanceof TFile) {
        await this.setFileData(file);
      }
    }
    return super.setState(state, result);
  }
}

class PurViewPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    console.info(`PurView ${PURVIEW_VERSION} loaded`);

    this.registerView(
      VIEW_TYPE_PURVIEW,
      (leaf) => new PureViewView(leaf, this),
    );
    this.registerExtensions(["pur"], VIEW_TYPE_PURVIEW);
    this.addSettingTab(new PurViewSettingTab(this.app, this));

    this.registerDomEvent(
      document,
      "click",
      (e) => {
        if (!this.settings.openInNewTab) return;
        const target = e.target.closest(".nav-file-title");
        if (!target) return;

        const path = target.getAttribute("data-path");
        if (path && path.endsWith(".pur")) {
          e.stopPropagation();
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            this.app.workspace.getLeaf("tab").openFile(file);
          }
        }
      },
      { capture: true },
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PURVIEW).forEach((leaf) => {
      if (leaf.view instanceof PureViewView) {
        leaf.view.updateThemeClass();
      }
    });
  }
}

class PurViewSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "PurView" });

    containerEl.createEl("p", {
      text: "PureRef 1.x boards open directly. PureRef 2.x boards require PureRef installed on your computer.",
    });

    new Setting(containerEl)
      .setName("Match theme")
      .setDesc(
        "Uses your current Obsidian theme background color and header styling for the canvas instead of default dark grey.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.matchThemeBackground)
          .onChange(async (value) => {
            this.plugin.settings.matchThemeBackground = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open in new tab")
      .setDesc(
        "When left-clicking a .pur file in the file explorer, automatically open it in a new tab to avoid replacing your current note.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openInNewTab)
          .onChange(async (value) => {
            this.plugin.settings.openInNewTab = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("PureRef executable path")
      .setDesc(
        "Required for PureRef 2.x boards. Leave blank to auto-detect. macOS: /Applications/PureRef.app/Contents/MacOS/PureRef",
      )
      .addText((text) =>
        text
          .setPlaceholder(defaultPureRefPath())
          .setValue(this.plugin.settings.pureRefPath)
          .onChange(async (value) => {
            this.plugin.settings.pureRefPath = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}

module.exports = PurViewPlugin;
