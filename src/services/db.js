import Dexie from 'dexie'

const db = new Dexie('AlphaDAPR')

db.version(1).stores({
  users: '++id, email, name',
  sketches: '++id, userId, title, createdAt',
  participants: '++id, sketchId',
  detections: '++id, sketchId, category',
  daprScores: '++id, sketchId',
})

export default db

// ---------------------------------------------------------------------------
// Password hashing (client-side demo only)
// ---------------------------------------------------------------------------

async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'alphadapr-salt')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

export async function createUser(name, email, password) {
  const existing = await db.users.where('email').equals(email).first()
  if (existing) throw new Error('Email already registered')

  const hashedPassword = await hashPassword(password)
  const id = await db.users.add({
    name,
    email,
    hashedPassword,
    role: 'therapist',
    createdAt: new Date().toISOString(),
  })
  return db.users.get(id)
}

export async function findUserByEmail(email) {
  return db.users.where('email').equals(email).first()
}

export async function verifyPassword(email, password) {
  const user = await findUserByEmail(email)
  if (!user) return null

  const hashed = await hashPassword(password)
  if (user.hashedPassword !== hashed) return null

  return user
}

// ---------------------------------------------------------------------------
// Sketch operations
// ---------------------------------------------------------------------------

export async function createSketch(
  userId,
  { title, imageDataUrl, strokeData, duration, lineCount, participantAge, participantGender },
) {
  let participantId = null
  if (participantAge !== undefined || participantGender !== undefined) {
    participantId = await db.participants.add({
      age: participantAge ?? null,
      gender: participantGender ?? null,
      additionalInfo: {},
      createdAt: new Date().toISOString(),
    })
  }

  const id = await db.sketches.add({
    userId,
    participantId,
    title: title || 'Untitled',
    imageDataUrl: imageDataUrl || null,
    strokeData: strokeData ? JSON.parse(JSON.stringify(strokeData)) : null,
    duration: duration || null,
    lineCount: lineCount || null,
    participantAge: participantAge || null,
    participantGender: participantGender || null,
    analyzed: false,
    createdAt: new Date().toISOString(),
  })
  return db.sketches.get(id)
}

export async function getSketchesByUser(userId) {
  return db.sketches.where('userId').equals(userId).reverse().sortBy('createdAt')
}

export async function getSketchById(id) {
  return db.sketches.get(id)
}

export async function deleteSketch(id) {
  await db.transaction('rw', [db.sketches, db.detections, db.daprScores, db.participants], async () => {
    const sketch = await db.sketches.get(id)
    if (!sketch) return

    await db.detections.where('sketchId').equals(id).delete()
    await db.daprScores.where('sketchId').equals(id).delete()

    if (sketch.participantId) {
      await db.participants.delete(sketch.participantId)
    }

    await db.sketches.delete(id)
  })
}

// ---------------------------------------------------------------------------
// Detection operations
// ---------------------------------------------------------------------------

export async function saveDetections(sketchId, detections) {
  await db.transaction('rw', [db.detections, db.sketches], async () => {
    // Remove existing detections for this sketch
    await db.detections.where('sketchId').equals(sketchId).delete()

    const records = detections.map((d) => ({
      sketchId,
      category: d.category,
      bbox: d.bbox, // [x1, y1, x2, y2]
      confidence: d.confidence,
      classId: d.class_id ?? d.classId ?? null,
      createdAt: new Date().toISOString(),
    }))

    await db.detections.bulkAdd(records)
    await db.sketches.update(sketchId, { analyzed: true })
  })
}

export async function getDetections(sketchId) {
  return db.detections.where('sketchId').equals(sketchId).toArray()
}

export async function deleteDetection(detectionId) {
  return db.detections.delete(detectionId)
}

export async function addDetection(sketchId, detection) {
  const id = await db.detections.add({
    sketchId,
    category: detection.category,
    bbox: detection.bbox,
    confidence: detection.confidence,
    classId: detection.class_id ?? detection.classId ?? null,
    createdAt: new Date().toISOString(),
  })
  return db.detections.get(id)
}

// ---------------------------------------------------------------------------
// DAPR Score operations
// ---------------------------------------------------------------------------

export async function saveDAPRScore(sketchId, scoreData) {
  // Remove existing score for this sketch (one-to-one relationship)
  await db.daprScores.where('sketchId').equals(sketchId).delete()

  const id = await db.daprScores.add({
    sketchId,
    stressScore: scoreData.stress_score ?? scoreData.stressScore ?? 0,
    resourceScore: scoreData.resource_score ?? scoreData.resourceScore ?? 0,
    totalScore: scoreData.total_score ?? scoreData.totalScore ?? 0,
    stressItems: scoreData.stress_items ?? scoreData.stressItems ?? {},
    resourceItems: scoreData.resource_items ?? scoreData.resourceItems ?? {},
    attributes: scoreData.attributes ?? {},
    interpretation: scoreData.interpretation ?? '',
    createdAt: new Date().toISOString(),
  })
  return db.daprScores.get(id)
}

export async function getDAPRScore(sketchId) {
  return db.daprScores.where('sketchId').equals(sketchId).first()
}

// ---------------------------------------------------------------------------
// Dashboard data
// ---------------------------------------------------------------------------

export async function getDashboardData(sketchId) {
  const sketch = await db.sketches.get(sketchId)
  if (!sketch) return null

  const participant = sketch.participantId ? await db.participants.get(sketch.participantId) : null
  const detections = await getDetections(sketchId)
  const daprScore = await getDAPRScore(sketchId)

  // Find similar sketches (total_score within ±10)
  let similarSketches = []
  if (daprScore) {
    const allScores = await db.daprScores.toArray()
    const similarScoreIds = allScores
      .filter(
        (s) =>
          s.sketchId !== sketchId &&
          Math.abs(s.totalScore - daprScore.totalScore) <= 10,
      )
      .map((s) => s.sketchId)

    if (similarScoreIds.length > 0) {
      similarSketches = await db.sketches.where('id').anyOf(similarScoreIds).toArray()
    }
  }

  const scoreDistribution = await getScoreDistribution()

  return { sketch, participant, detections, daprScore, similarSketches, scoreDistribution }
}

export async function getScoreDistribution() {
  const allScores = await db.daprScores.toArray()

  // Build histogram: 0-10, 10-20, ..., 90-100
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    min: i * 10,
    max: (i + 1) * 10,
    count: 0,
  }))

  for (const score of allScores) {
    const idx = Math.min(Math.floor(score.totalScore / 10), 9)
    buckets[idx].count++
  }

  return buckets
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export async function getStats(userId) {
  const allSketches = await db.sketches.where('userId').equals(userId).toArray()
  const totalSketches = allSketches.length
  const analyzedSketches = allSketches.filter((s) => s.analyzed).length

  let avgScore = 0
  if (analyzedSketches > 0) {
    const sketchIds = allSketches.filter((s) => s.analyzed).map((s) => s.id)
    const scores = await db.daprScores.where('sketchId').anyOf(sketchIds).toArray()
    if (scores.length > 0) {
      avgScore = scores.reduce((sum, s) => sum + s.totalScore, 0) / scores.length
    }
  }

  return { totalSketches, analyzedSketches, avgScore: Math.round(avgScore * 100) / 100 }
}
