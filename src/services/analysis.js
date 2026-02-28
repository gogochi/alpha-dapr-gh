// src/services/analysis.js
// Analysis pipeline: detection → scoring → persist to IndexedDB
import { detectObjects } from './detection'
import { calculateDAPRScore } from './scoring'
import {
  saveDetections,
  saveDAPRScore,
  getDetections,
  getDAPRScore,
  getSketchById,
  deleteDetection,
  addDetection,
} from './db'

/**
 * Convert detection bbox [x1, y1, x2, y2] to scoring format {bbox_x, bbox_y, bbox_w, bbox_h}
 */
function toScoringFormat(detections) {
  return detections.map((d) => ({
    category: d.category,
    bbox_x: d.bbox?.[0] ?? d.bbox_x ?? 0,
    bbox_y: d.bbox?.[1] ?? d.bbox_y ?? 0,
    bbox_w: (d.bbox ? d.bbox[2] - d.bbox[0] : d.bbox_w) ?? 0,
    bbox_h: (d.bbox ? d.bbox[3] - d.bbox[1] : d.bbox_h) ?? 0,
    confidence: d.confidence,
  }))
}

/**
 * Run full analysis pipeline on a sketch
 * @param {number} sketchId
 * @param {Object} options - { useOnnx: false, confidenceThreshold: 0.25 }
 * @returns {Promise<{detections: Array, daprScore: Object}>}
 */
export async function runAnalysis(sketchId, options = {}) {
  const sketch = await getSketchById(sketchId)
  if (!sketch) throw new Error('找不到草圖')

  const img = await loadImage(sketch.imageDataUrl)
  const detections = await detectObjects(img, options)

  // saveDetections also marks sketch.analyzed = true
  await saveDetections(sketchId, detections)

  const scoringObjects = toScoringFormat(detections)
  const daprScore = calculateDAPRScore(scoringObjects, img.width, img.height)
  await saveDAPRScore(sketchId, daprScore)

  return { detections, daprScore }
}

/**
 * Re-calculate score after manual corrections (remove/add detections)
 * @param {number} sketchId
 * @returns {Promise<{detections: Array, daprScore: Object}>}
 */
export async function recalculateScore(sketchId) {
  const sketch = await getSketchById(sketchId)
  const img = await loadImage(sketch.imageDataUrl)
  const detections = await getDetections(sketchId)

  const scoringObjects = toScoringFormat(detections)
  const daprScore = calculateDAPRScore(scoringObjects, img.width, img.height)
  await saveDAPRScore(sketchId, daprScore)

  return { detections, daprScore }
}

/**
 * Remove a detection and recalculate score
 * @param {number} sketchId
 * @param {number} detectionId
 * @returns {Promise<{detections: Array, daprScore: Object}>}
 */
export async function removeDetection(sketchId, detectionId) {
  await deleteDetection(detectionId)
  return recalculateScore(sketchId)
}

/**
 * Add a manual detection and recalculate score
 * @param {number} sketchId
 * @param {Object} detection - { category, bbox, confidence }
 * @returns {Promise<{detections: Array, daprScore: Object}>}
 */
export async function addManualDetection(sketchId, detection) {
  await addDetection(sketchId, detection)
  return recalculateScore(sketchId)
}

/**
 * Get existing analysis results without re-running
 * @param {number} sketchId
 * @returns {Promise<{detections: Array, daprScore: Object|undefined}>}
 */
export async function getAnalysisResults(sketchId) {
  const detections = await getDetections(sketchId)
  const daprScore = await getDAPRScore(sketchId)
  return { detections, daprScore }
}

// Helper: load an HTMLImageElement from a data URL
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}
