// src/services/detection.js
// Client-side object detection service for AlphaDAPR
// Supports ONNX Runtime Web inference and placeholder mode

// onnxruntime-web is loaded dynamically only when ONNX mode is requested
let ort = null

// Class labels matching the training config (SceneDAPR order)
export const CLASS_NAMES = ['person', 'rain', 'umbrella', 'lightning', 'cloud', 'puddle']

const MODEL_INPUT_SIZE = 640
const MODEL_PATH = '/models/dapr.onnx'

// Cached ONNX session to avoid reloading
let cachedSession = null

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
    confidenceThreshold = 0.25,
    iouThreshold = 0.45,
    useOnnx = false,
  } = options

  const { canvas, width, height } = await getCanvasFromSource(imageSource)

  if (!useOnnx) {
    return placeholderDetect(width, height)
  }

  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, width, height)
  return onnxInference(imageData, width, height, { confidenceThreshold, iouThreshold })
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
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { canvas, width: canvas.width, height: canvas.height }
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
  const input = preprocessImage(imageData, origWidth, origHeight)
  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])

  const feeds = {}
  const inputName = session.inputNames[0]
  feeds[inputName] = tensor

  const results = await session.run(feeds)
  const outputName = session.outputNames[0]
  const output = results[outputName]

  // YOLOv8 output: (1, numClasses + 4, 8400) → parse boxes + class scores
  return postprocessOutput(output, origWidth, origHeight, confidenceThreshold, iouThreshold)
}

/**
 * Load or retrieve cached ONNX session
 */
async function getOnnxSession() {
  if (cachedSession) return cachedSession
  if (!ort) {
    ort = await import('onnxruntime-web')
  }
  cachedSession = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['wasm'],
  })
  return cachedSession
}

/**
 * Preprocess image data for YOLOv8: resize to 640x640, normalize, CHW format
 * @returns {Float32Array} - [1, 3, 640, 640] tensor data
 */
function preprocessImage(imageData, origWidth, origHeight) {
  // Use an offscreen canvas to resize
  const resizeCanvas = document.createElement('canvas')
  resizeCanvas.width = MODEL_INPUT_SIZE
  resizeCanvas.height = MODEL_INPUT_SIZE
  const ctx = resizeCanvas.getContext('2d')

  // Draw source image data onto a temporary canvas first
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = origWidth
  srcCanvas.height = origHeight
  const srcCtx = srcCanvas.getContext('2d')
  srcCtx.putImageData(imageData, 0, 0)

  // Resize with letterboxing (stretch to fill for simplicity, matching common YOLO preprocessing)
  ctx.drawImage(srcCanvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const resized = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const pixels = resized.data

  // Convert RGBA → CHW float32 normalized to [0, 1]
  const size = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
  const float32Data = new Float32Array(3 * size)

  for (let i = 0; i < size; i++) {
    const ri = i * 4
    float32Data[i] = pixels[ri] / 255.0             // R → channel 0
    float32Data[size + i] = pixels[ri + 1] / 255.0  // G → channel 1
    float32Data[2 * size + i] = pixels[ri + 2] / 255.0 // B → channel 2
  }

  return float32Data
}

/**
 * Post-process YOLOv8 output tensor
 * YOLOv8 output shape: (1, 4 + numClasses, 8400)
 * Each of 8400 predictions: [cx, cy, w, h, class0_score, class1_score, ...]
 */
function postprocessOutput(outputTensor, origWidth, origHeight, confidenceThreshold, iouThreshold) {
  const data = outputTensor.data
  const [, numFeatures, numPredictions] = outputTensor.dims
  const numClasses = numFeatures - 4
  const scaleX = origWidth / MODEL_INPUT_SIZE
  const scaleY = origHeight / MODEL_INPUT_SIZE

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

    if (maxScore < confidenceThreshold) continue

    // Convert from center format to corner format and scale to original image
    const x1 = (cx - w / 2) * scaleX
    const y1 = (cy - h / 2) * scaleY
    const x2 = (cx + w / 2) * scaleX
    const y2 = (cy + h / 2) * scaleY

    boxes.push([x1, y1, x2, y2])
    scores.push(maxScore)
    classIds.push(maxClassId)
  }

  // Apply NMS
  const keepIndices = nms(boxes, scores, iouThreshold)

  return keepIndices.map((idx) => ({
    category: classIds[idx] < CLASS_NAMES.length ? CLASS_NAMES[classIds[idx]] : `class_${classIds[idx]}`,
    bbox: boxes[idx].map((v) => Math.round(v * 100) / 100),
    confidence: Math.round(scores[idx] * 1000) / 1000,
    class_id: classIds[idx],
  }))
}

/**
 * Non-Maximum Suppression
 * @param {Array<number[]>} boxes - [[x1,y1,x2,y2], ...]
 * @param {number[]} scores - confidence scores
 * @param {number} iouThreshold - IoU threshold for suppression
 * @returns {number[]} indices of kept boxes
 */
function nms(boxes, scores, iouThreshold) {
  // Sort by score descending
  const indices = scores.map((_, i) => i)
  indices.sort((a, b) => scores[b] - scores[a])

  const keep = []
  const suppressed = new Set()

  for (const i of indices) {
    if (suppressed.has(i)) continue
    keep.push(i)

    for (const j of indices) {
      if (j <= i || suppressed.has(j)) continue
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
    class_id: 0,
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
      class_id: 1,
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
      class_id: 2,
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
