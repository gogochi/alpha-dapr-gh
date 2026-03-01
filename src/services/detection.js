// src/services/detection.js
// Client-side object detection service for AlphaDAPR
// Supports ONNX Runtime Web inference and placeholder mode

// onnxruntime-web is loaded dynamically only when ONNX mode is requested
let ort = null

// Class labels matching the training config (SceneDAPR order)
export const CLASS_NAMES = ['rain', 'umbrella', 'person', 'lightning', 'cloud', 'puddle']
// Per-class confidence thresholds (raised to reduce false positives)
const CLASS_CONFIDENCE = {
  rain: 0.6,
  umbrella: 0.5,
  person: 0.5,
  lightning: 0.5,
  cloud: 0.5,
  puddle: 0.5,
}
const MIN_DETECTION_AREA = 400 // Minimum bbox area in px² to filter tiny false positives
const MIN_INK_RATIO = 0.05 // Minimum ratio of non-white pixels in bbox to keep detection

const MODEL_INPUT_SIZE = 640
const MODEL_PATH = '/models/dapr.onnx'

// Cached ONNX session to avoid reloading
let cachedSession = null

// Reusable canvas for source conversion to avoid repeated allocations
let reusableCanvas = null
function getReusableCanvas(width, height) {
  if (!reusableCanvas) {
    reusableCanvas = document.createElement('canvas')
  }
  reusableCanvas.width = width
  reusableCanvas.height = height
  return reusableCanvas
}

/**
 * Detect objects in an image
 * @param {HTMLImageElement|HTMLCanvasElement|string} imageSource - Image element, canvas, or data URL
 * @param {Object} options
 * @param {number} options.confidenceThreshold - Minimum confidence (default: 0.25)
 * @param {number} options.iouThreshold - NMS IoU threshold (default: 0.45)
 * @param {boolean} options.useOnnx - Use ONNX model inference (default: false)
 * @returns {Promise<Array<{category: string, bbox: number[], confidence: number, class_id: number}>>}
 */
export async function detectObjects(imageSource, options = {}) {
  const {
    confidenceThreshold = 0.5,
    iouThreshold = 0.45,
    useOnnx = true,
  } = options

  const { canvas, width, height } = await getCanvasFromSource(imageSource)

  if (!useOnnx) {
    return placeholderDetect(width, height)
  }

  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, width, height)
  try {
    const detections = await onnxInference(imageData, width, height, { confidenceThreshold, iouThreshold })
    return filterByContent(detections, imageData, width)
  } catch (e) {
    console.warn('ONNX inference failed, falling back to placeholder:', e.message)
    return placeholderDetect(width, height)
  }
}

/**
 * Filter out detections in blank areas by checking pixel content
 * If the bbox area has very few non-white pixels (no ink/strokes), discard it
 */
function filterByContent(detections, imageData, imgWidth) {
  const pixels = imageData.data
  return detections.filter((det) => {
    const [x1, y1, x2, y2] = det.bbox
    const bx1 = Math.max(0, Math.floor(x1))
    const by1 = Math.max(0, Math.floor(y1))
    const bx2 = Math.min(imgWidth, Math.ceil(x2))
    const by2 = Math.min(imageData.height, Math.ceil(y2))
    const bw = bx2 - bx1
    const bh = by2 - by1
    if (bw <= 0 || bh <= 0) return false

    let inkPixels = 0
    const totalPixels = bw * bh
    // Sample pixels (every 2nd pixel for speed) to check for non-white content
    for (let y = by1; y < by2; y += 2) {
      for (let x = bx1; x < bx2; x += 2) {
        const idx = (y * imgWidth + x) * 4
        const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2]
        // Pixel is "ink" if it's not near-white (below 240 in any channel)
        if (r < 240 || g < 240 || b < 240) inkPixels++
      }
    }
    // Adjust for sampling (every 2nd pixel)
    const sampledTotal = Math.ceil(bh / 2) * Math.ceil(bw / 2)
    const inkRatio = sampledTotal > 0 ? inkPixels / sampledTotal : 0
    return inkRatio >= MIN_INK_RATIO
  })
}

/**
 * Resolve an image source to a canvas with its dimensions
 * @param {HTMLImageElement|HTMLCanvasElement|string} source
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
 */
async function getCanvasFromSource(source) {
  if (source instanceof HTMLCanvasElement) {
    return { canvas: source, width: source.width, height: source.height }
  }

  const img = await resolveImage(source)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const canvas = getReusableCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { canvas, width: w, height: h }
}

/**
 * Resolve a string (data URL or path) to an HTMLImageElement
 */
function resolveImage(source) {
  if (source instanceof HTMLImageElement) {
    if (source.complete) return Promise.resolve(source)
    return new Promise((resolve, reject) => {
      source.onload = () => resolve(source)
      source.onerror = reject
    })
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${source}`))
    img.src = source
  })
}

/**
 * Run ONNX inference on image data
 * @param {ImageData} imageData - Raw pixel data from canvas
 * @param {number} origWidth - Original image width
 * @param {number} origHeight - Original image height
 * @param {Object} options - { confidenceThreshold, iouThreshold }
 * @returns {Promise<Array>} detections
 */
async function onnxInference(imageData, origWidth, origHeight, options) {
  const { confidenceThreshold, iouThreshold } = options
  const session = await getOnnxSession()

  // Preprocess: resize to 640x640, normalize to [0,1], CHW format, batch dim
  const { data: input, scale, padX, padY } = preprocessImage(imageData, origWidth, origHeight)
  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])

  const feeds = {}
  const inputName = session.inputNames[0]
  feeds[inputName] = tensor

  const results = await session.run(feeds)
  const outputName = session.outputNames[0]
  const output = results[outputName]

  // YOLOv8 output: (1, numClasses + 4, 8400) → parse boxes + class scores
  return postprocessOutput(output, origWidth, origHeight, confidenceThreshold, iouThreshold, scale, padX, padY)
}

/**
 * Load or retrieve cached ONNX session
 */
async function getOnnxSession() {
  if (cachedSession) return cachedSession
  if (!ort) {
    ort = await import('onnxruntime-web')
  }
  try {
    cachedSession = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['webgl', 'wasm'],
    })
  } catch {
    cachedSession = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['wasm'],
    })
  }
  return cachedSession
}

/**
 * Preprocess image data for YOLOv8: letterbox resize to 640x640, normalize, CHW format
 * @returns {{ data: Float32Array, scale: number, padX: number, padY: number }}
 */
function preprocessImage(imageData, origWidth, origHeight) {
  // Letterbox: scale to fit 640×640 preserving aspect ratio, pad with gray (114/255)
  const scale = Math.min(MODEL_INPUT_SIZE / origWidth, MODEL_INPUT_SIZE / origHeight)
  const newW = Math.round(origWidth * scale)
  const newH = Math.round(origHeight * scale)
  const padX = Math.round((MODEL_INPUT_SIZE - newW) / 2)
  const padY = Math.round((MODEL_INPUT_SIZE - newH) / 2)

  const resizeCanvas = document.createElement('canvas')
  resizeCanvas.width = MODEL_INPUT_SIZE
  resizeCanvas.height = MODEL_INPUT_SIZE
  const ctx = resizeCanvas.getContext('2d')

  // Fill with gray (standard YOLO letterbox padding color: 114)
  ctx.fillStyle = 'rgb(114, 114, 114)'
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

  // Draw source image scaled and centered
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = origWidth
  srcCanvas.height = origHeight
  srcCanvas.getContext('2d').putImageData(imageData, 0, 0)
  ctx.drawImage(srcCanvas, padX, padY, newW, newH)

  const resized = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const pixels = resized.data
  const size = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
  const float32Data = new Float32Array(3 * size)

  for (let i = 0; i < size; i++) {
    const ri = i * 4
    float32Data[i] = pixels[ri] / 255.0
    float32Data[size + i] = pixels[ri + 1] / 255.0
    float32Data[2 * size + i] = pixels[ri + 2] / 255.0
  }

  return { data: float32Data, scale, padX, padY }
}

/**
 * Post-process YOLOv8 output tensor
 * YOLOv8 output shape: (1, 4 + numClasses, 8400)
 * Each of 8400 predictions: [cx, cy, w, h, class0_score, class1_score, ...]
 */
function postprocessOutput(outputTensor, origWidth, origHeight, confidenceThreshold, iouThreshold, scale, padX, padY) {
  const data = outputTensor.data
  const [, numFeatures, numPredictions] = outputTensor.dims
  const numClasses = numFeatures - 4

  const boxes = []
  const scores = []
  const classIds = []

  for (let i = 0; i < numPredictions; i++) {
    // Extract box coords (cx, cy, w, h) — data is in column-major for this dim
    const cx = data[0 * numPredictions + i]
    const cy = data[1 * numPredictions + i]
    const w = data[2 * numPredictions + i]
    const h = data[3 * numPredictions + i]

    // Find best class score
    let maxScore = 0
    let maxClassId = 0
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numPredictions + i]
      if (score > maxScore) {
        maxScore = score
        maxClassId = c
      }
    }

    const className = maxClassId < CLASS_NAMES.length ? CLASS_NAMES[maxClassId] : null
    const classThreshold = (className && CLASS_CONFIDENCE[className]) || confidenceThreshold
    if (maxScore < classThreshold) continue

    // Convert from center format to corner format and scale to original image
    const x1 = (cx - w / 2 - padX) / scale
    const y1 = (cy - h / 2 - padY) / scale
    const x2 = (cx + w / 2 - padX) / scale
    const y2 = (cy + h / 2 - padY) / scale

    boxes.push([x1, y1, x2, y2])
    scores.push(maxScore)
    classIds.push(maxClassId)
  }

  // Apply per-class NMS (matching copilot backend behavior)
  const keepIndices = nms(boxes, scores, iouThreshold, classIds)

  return keepIndices
    .map((idx) => ({
      category: classIds[idx] < CLASS_NAMES.length ? CLASS_NAMES[classIds[idx]] : `class_${classIds[idx]}`,
      bbox: boxes[idx].map((v) => Math.round(v * 100) / 100),
      confidence: Math.round(scores[idx] * 1000) / 1000,
      class_id: classIds[idx],
    }))
    .filter((det) => {
      const w = det.bbox[2] - det.bbox[0]
      const h = det.bbox[3] - det.bbox[1]
      return w * h >= MIN_DETECTION_AREA
    })
}

/**
 * Per-class Non-Maximum Suppression (matching copilot backend behavior)
 * Only suppresses overlapping boxes of the SAME class
 * @param {Array<number[]>} boxes - [[x1,y1,x2,y2], ...]
 * @param {number[]} scores - confidence scores
 * @param {number[]} classIds - class IDs for each box
 * @param {number} iouThreshold - IoU threshold for suppression
 * @returns {number[]} indices of kept boxes
 */
function nms(boxes, scores, iouThreshold, classIds = null) {
  const order = scores.map((_, i) => i)
  order.sort((a, b) => scores[b] - scores[a])

  const keep = []
  const suppressed = new Set()

  for (let si = 0; si < order.length; si++) {
    const i = order[si]
    if (suppressed.has(i)) continue
    keep.push(i)

    for (let sj = si + 1; sj < order.length; sj++) {
      const j = order[sj]
      if (suppressed.has(j)) continue
      // Per-class: only suppress if same class
      if (classIds && classIds[i] !== classIds[j]) continue
      if (calculateIoU(boxes[i], boxes[j]) > iouThreshold) {
        suppressed.add(j)
      }
    }
  }

  return keep
}

/**
 * Calculate IoU (Intersection over Union) between two boxes
 * @param {number[]} box1 - [x1, y1, x2, y2]
 * @param {number[]} box2 - [x1, y1, x2, y2]
 * @returns {number} IoU value
 */
function calculateIoU(box1, box2) {
  const x1 = Math.max(box1[0], box2[0])
  const y1 = Math.max(box1[1], box2[1])
  const x2 = Math.min(box1[2], box2[2])
  const y2 = Math.min(box1[3], box2[3])

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (intersection === 0) return 0

  const area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
  const area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
  const union = area1 + area2 - intersection

  return union <= 0 ? 0 : intersection / union
}

/**
 * Placeholder detection for demo without model
 * Generates reasonable random detections based on image dimensions,
 * mirroring the Python _placeholder_detect logic with added randomness.
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Array<{category: string, bbox: number[], confidence: number, class_id: number}>}
 */
function placeholderDetect(width, height) {
  const detections = []
  const randConf = () => 0.6 + Math.random() * 0.35 // confidence between 0.6–0.95

  // Always include a person detection (centered, 40-60% of image height)
  const personH = height * (0.4 + Math.random() * 0.2)
  const personW = personH * (0.3 + Math.random() * 0.15)
  const personX = (width - personW) / 2 + (Math.random() - 0.5) * width * 0.1
  const personY = height - personH - height * 0.05
  detections.push({
    category: 'person',
    bbox: [personX, personY, personX + personW, personY + personH],
    confidence: randConf(),
    class_id: 2,
  })

  // Random rain drops (3-8 small boxes in upper area)
  const rainCount = 3 + Math.floor(Math.random() * 6)
  for (let i = 0; i < rainCount; i++) {
    const rx = Math.random() * width * 0.9
    const ry = Math.random() * height * 0.4
    const rw = width * (0.02 + Math.random() * 0.03)
    const rh = height * (0.03 + Math.random() * 0.05)
    detections.push({
      category: 'rain',
      bbox: [rx, ry, rx + rw, ry + rh],
      confidence: randConf(),
      class_id: 0,
    })
  }

  // 50% chance of umbrella (above person)
  if (Math.random() < 0.5) {
    const umbW = personW * 1.2
    const umbH = height * 0.15
    const umbX = personX - (umbW - personW) / 2
    const umbY = personY - umbH - height * 0.02
    detections.push({
      category: 'umbrella',
      bbox: [umbX, umbY, umbX + umbW, umbY + umbH],
      confidence: randConf(),
      class_id: 1,
    })
  }

  // 20% chance of cloud (upper area)
  if (Math.random() < 0.2) {
    const cw = width * (0.2 + Math.random() * 0.2)
    const ch = height * (0.1 + Math.random() * 0.1)
    const cx = Math.random() * (width - cw)
    const cy = Math.random() * height * 0.15
    detections.push({
      category: 'cloud',
      bbox: [cx, cy, cx + cw, cy + ch],
      confidence: randConf(),
      class_id: 4,
    })
  }

  // 10% chance of lightning
  if (Math.random() < 0.1) {
    const lw = width * 0.05
    const lh = height * 0.3
    const lx = width * (0.2 + Math.random() * 0.6)
    const ly = height * 0.05
    detections.push({
      category: 'lightning',
      bbox: [lx, ly, lx + lw, ly + lh],
      confidence: randConf(),
      class_id: 3,
    })
  }

  // 10% chance of puddle (bottom area)
  if (Math.random() < 0.1) {
    const pw = width * (0.2 + Math.random() * 0.3)
    const ph = height * (0.05 + Math.random() * 0.05)
    const px = Math.random() * (width - pw)
    const py = height - ph - height * 0.02
    detections.push({
      category: 'puddle',
      bbox: [px, py, px + pw, py + ph],
      confidence: randConf(),
      class_id: 5,
    })
  }

  // Round all bbox values
  return detections.map((d) => ({
    ...d,
    bbox: d.bbox.map((v) => Math.round(v * 100) / 100),
    confidence: Math.round(d.confidence * 1000) / 1000,
  }))
}

/**
 * Pre-load and warm up the ONNX model for faster first inference
 * Call this during app initialization to avoid cold-start latency
 */
export async function warmupModel() {
  try {
    const session = await getOnnxSession()
    // Run a dummy inference to warm up the model
    const dummyInput = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    const tensor = new ort.Tensor('float32', dummyInput, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
    const feeds = {}
    feeds[session.inputNames[0]] = tensor
    await session.run(feeds)
  } catch {
    // Warm-up failure is non-critical
  }
}
