/**
 * AlphaDAPR - DAPR 評分邏輯
 *
 * 基於 Lack (1996) 的 DAPR 評分量表：
 * - 壓力相關項目 (16 項): 反映感知到的壓力水平
 * - 資源相關項目 (19 項): 反映應對壓力的能力
 *
 * 最終 DAPR 分數 = 資源分 - 壓力分
 *
 * 三類評分資訊：
 * 1. 頻率資訊 (Frequency-related): 各類別物件數量
 * 2. 距離資訊 (Distance-related): 物件間中心點距離
 * 3. 面積資訊 (Area-related): 物件面積（像素轉英吋）
 */

// 像素轉英吋的轉換係數 (假設 96 DPI)
const PIXELS_PER_INCH = 96.0;

// 超過此數量的雨滴視為過量
const EXCESS_RAIN_THRESHOLD = 5;

// DAPR 評分量表定義 — 壓力相關項目 (16 項)
const STRESS_ITEMS = [
  { name: 'no_rain', description: 'Rain is present, No rain or other precipitation', method: 'frequency' },
  { name: 'excess_rain', description: 'Excessive amount of rain', method: 'frequency' },
  { name: 'rain_hitting_person', description: 'Rain hitting the person', method: 'distance' },
  { name: 'stormy_rain', description: 'Stormy or driven rain (at an angle)', method: 'frequency' },
  { name: 'lightning', description: 'Lightning present', method: 'frequency' },
  { name: 'lightning_hits', description: 'Lightning hits person', method: 'distance' },
  { name: 'puddles', description: 'Puddles present', method: 'frequency' },
  { name: 'standing_in_puddle', description: 'Person standing in puddle(s)', method: 'distance' },
  { name: 'clouds', description: 'Clouds present', method: 'frequency' },
  { name: 'dark_clouds', description: 'Dark or ominous clouds', method: 'frequency' },
  { name: 'no_person', description: 'No person drawn', method: 'frequency' },
  { name: 'figure_small', description: 'Figure less than 2 inches', method: 'area' },
  { name: 'figure_large', description: 'Figure larger than 6 inches', method: 'area' },
  { name: 'no_facial_features', description: 'No facial features on person', method: 'frequency' },
  { name: 'body_exposed', description: 'Body exposed to rain', method: 'distance' },
  { name: 'sad_expression', description: 'Sad or distressed expression', method: 'frequency' },
];

// DAPR 評分量表定義 — 資源相關項目 (19 項)
const RESOURCE_ITEMS = [
  { name: 'umbrella_present', description: 'Umbrella is present', method: 'frequency' },
  { name: 'umbrella_covers', description: 'Umbrella covers person', method: 'distance' },
  { name: 'umbrella_intact', description: 'Umbrella is intact and functional', method: 'frequency' },
  { name: 'raincoat', description: 'Raincoat or protective clothing', method: 'frequency' },
  { name: 'boots', description: 'Boots or rain shoes', method: 'frequency' },
  { name: 'hat', description: 'Hat or head covering', method: 'frequency' },
  { name: 'shelter', description: 'Shelter or building', method: 'frequency' },
  { name: 'figure_appropriate_size', description: 'Figure between 2-6 inches', method: 'area' },
  { name: 'grounded_figure', description: 'Figure is grounded (standing on ground)', method: 'frequency' },
  { name: 'complete_person', description: 'Person has complete body parts', method: 'frequency' },
  { name: 'facial_features', description: 'Person has facial features', method: 'frequency' },
  { name: 'smiling', description: 'Person is smiling or happy', method: 'frequency' },
  { name: 'movement', description: 'Person shows movement or action', method: 'frequency' },
  { name: 'sun_present', description: 'Sun or rainbow present', method: 'frequency' },
  { name: 'flowers_nature', description: 'Flowers or nature elements', method: 'frequency' },
  { name: 'multiple_resources', description: 'Multiple coping resources', method: 'frequency' },
  { name: 'detailed_drawing', description: 'Drawing shows detail and care', method: 'frequency' },
  { name: 'centered_figure', description: 'Figure is centered on page', method: 'area' },
  { name: 'appropriate_proportions', description: 'Figure has appropriate proportions', method: 'area' },
];

// --------------- Helper functions ---------------

/**
 * 計算物件中心點
 * @param {{ bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number }} det
 * @returns {[number, number]}
 */
function getCenter(det) {
  return [(det.bbox_x + det.bbox_w) / 2, (det.bbox_y + det.bbox_h) / 2];
}

/**
 * 計算物件面積
 */
function getArea(det) {
  return det.bbox_w * det.bbox_h;
}

/**
 * 計算各類別物件數量
 */
function countByCategory(objects) {
  const counts = {};
  for (const obj of objects) {
    counts[obj.category] = (counts[obj.category] || 0) + 1;
  }
  return counts;
}

/**
 * 取得指定類別的所有物件
 */
function getObjectsByCategory(objects, category) {
  return objects.filter((obj) => obj.category === category);
}

/**
 * 計算兩個物件中心點之間的歐氏距離
 */
function calculateDistance(obj1, obj2) {
  const c1 = getCenter(obj1);
  const c2 = getCenter(obj2);
  return Math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2);
}

/**
 * 像素轉英吋
 */
function pixelsToInches(pixels) {
  return pixels / PIXELS_PER_INCH;
}

/**
 * 計算兩個 bounding box 的 Intersection over Union (IoU)
 */
function computeIoU(obj1, obj2) {
  const x1 = Math.max(obj1.bbox_x, obj2.bbox_x);
  const y1 = Math.max(obj1.bbox_y, obj2.bbox_y);
  const x2 = Math.min(obj1.bbox_x + obj1.bbox_w, obj2.bbox_x + obj2.bbox_w);
  const y2 = Math.min(obj1.bbox_y + obj1.bbox_h, obj2.bbox_y + obj2.bbox_h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = obj1.bbox_w * obj1.bbox_h;
  const area2 = obj2.bbox_w * obj2.bbox_h;
  const union = area1 + area2 - intersection;

  if (union <= 0) return 0.0;
  return intersection / union;
}

/**
 * 檢查兩個物件的 bounding box 是否重疊 (IoU > 0.05)
 */
function checkOverlap(obj1, obj2) {
  return computeIoU(obj1, obj2) > 0.05;
}

/**
 * 計算人物圖形的高度（英吋）— 取最大面積的 person
 */
function figureHeightInches(persons) {
  if (persons.length === 0) return 0.0;
  const mainPerson = persons.reduce((best, p) => (getArea(p) > getArea(best) ? p : best), persons[0]);
  return pixelsToInches(mainPerson.bbox_h);
}

// --------------- Stress scoring ---------------

/**
 * 計算壓力相關分數
 * @returns {{ score: number, details: Object }}
 */
function calculateStressScore(objects) {
  const counts = countByCategory(objects);
  const persons = getObjectsByCategory(objects, 'person');
  const rains = getObjectsByCategory(objects, 'rain');
  const lightnings = getObjectsByCategory(objects, 'lightning');
  const puddles = getObjectsByCategory(objects, 'puddle');
  const umbrellas = getObjectsByCategory(objects, 'umbrella');

  let score = 0;
  const details = {};

  // 1. no_rain — 有雨不加分，無雨加壓力分（異常狀態）
  const hasRain = (counts.rain || 0) > 0;
  if (!hasRain) {
    score += 1;
    details.no_rain = { score: 1, description: 'No rain drawn', keyword: '#No_rain' };
  }

  // 2. excess_rain
  const rainCount = counts.rain || 0;
  if (rainCount > EXCESS_RAIN_THRESHOLD) {
    score += 1;
    details.excess_rain = { score: 1, description: `Excessive rain (${rainCount} objects)`, keyword: '#Excess_rain' };
  }

  // 3. rain_hitting_person
  if (persons.length > 0 && rains.length > 0) {
    let found = false;
    for (const person of persons) {
      for (const rain of rains) {
        if (checkOverlap(person, rain)) {
          score += 1;
          details.rain_hitting_person = { score: 1, description: 'Rain overlaps with person', keyword: '#Rain_hitting' };
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // 4. stormy_rain — requires angle detection (not available from bbox alone; scored 0)

  // 5. lightning present
  if ((counts.lightning || 0) > 0) {
    score += 1;
    details.lightning = { score: 1, description: 'Lightning present', keyword: '#Lightning' };
  }

  // 6. lightning_hits person
  if (persons.length > 0 && lightnings.length > 0) {
    let found = false;
    for (const person of persons) {
      for (const lightning of lightnings) {
        const dist = calculateDistance(person, lightning);
        if (dist < Math.max(person.bbox_h, lightning.bbox_h) * 0.5) {
          score += 1;
          details.lightning_hits = { score: 1, description: 'Lightning near person', keyword: '#Lightning_hit' };
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // 7. puddles present
  const puddleCount = counts.puddle || 0;
  if (puddleCount > 0) {
    score += 1;
    details.puddles = { score: 1, description: `Puddle(s) present (${puddleCount})`, keyword: '#Puddles' };
  }

  // 8. standing_in_puddle
  if (persons.length > 0 && puddles.length > 0) {
    let found = false;
    for (const person of persons) {
      for (const puddle of puddles) {
        if (checkOverlap(person, puddle)) {
          score += 1;
          details.standing_in_puddle = { score: 1, description: 'Person standing in puddle', keyword: '#In_puddle' };
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // 9. clouds present
  if ((counts.cloud || 0) > 0) {
    score += 1;
    details.clouds = { score: 1, description: 'Clouds present', keyword: '#Clouds' };
  }

  // 10. dark_clouds — requires colour/intensity analysis (scored 0)

  // 11. no_person
  if ((counts.person || 0) === 0) {
    score += 1;
    details.no_person = { score: 1, description: 'No person drawn', keyword: '#No_person' };
  }

  // 12. figure_small (< 2 inches)
  if (persons.length > 0) {
    const heightInches = figureHeightInches(persons);
    if (heightInches < 2.0) {
      score += 1;
      details.figure_small = { score: 1, description: `Figure too small (${heightInches.toFixed(1)} inches)`, keyword: '#Small_figure' };
    }
  }

  // 13. figure_large (> 6 inches)
  if (persons.length > 0) {
    const heightInches = figureHeightInches(persons);
    if (heightInches > 6.0) {
      score += 1;
      details.figure_large = { score: 1, description: `Figure too large (${heightInches.toFixed(1)} inches)`, keyword: '#Large_figure' };
    }
  }

  // 14. no_facial_features — requires facial feature detection (scored 0)

  // 15. body_exposed (no umbrella covering)
  if (persons.length > 0 && rains.length > 0 && umbrellas.length === 0) {
    score += 1;
    details.body_exposed = { score: 1, description: 'Body exposed to rain without protection', keyword: '#Exposed' };
  }

  // 16. sad_expression — requires expression recognition (scored 0)

  return { score, details };
}

// --------------- Resource scoring ---------------

/**
 * 計算資源相關分數
 * @returns {{ score: number, details: Object }}
 */
function calculateResourceScore(objects, imageWidth, imageHeight) {
  const counts = countByCategory(objects);
  const persons = getObjectsByCategory(objects, 'person');
  const umbrellas = getObjectsByCategory(objects, 'umbrella');

  let score = 0;
  const details = {};

  // 1. umbrella_present
  if ((counts.umbrella || 0) > 0) {
    score += 1;
    details.umbrella_present = { score: 1, description: 'Umbrella present', keyword: '#Umbrella' };
  }

  // 2. umbrella_covers person
  if (persons.length > 0 && umbrellas.length > 0) {
    let found = false;
    for (const person of persons) {
      for (const umbrella of umbrellas) {
        if (checkOverlap(umbrella, person) && getCenter(umbrella)[1] < getCenter(person)[1]) {
          score += 1;
          details.umbrella_covers = { score: 1, description: 'Umbrella covers person', keyword: '#Umbrella_covers' };
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // 3. umbrella_intact — requires structural analysis (scored 0)
  // 4. raincoat — requires detection category (scored 0)
  // 5. boots — requires detection category (scored 0)
  // 6. hat — requires detection category (scored 0)
  // 7. shelter — requires detection category (scored 0)

  // 8. figure_appropriate_size (2–6 inches)
  if (persons.length > 0) {
    const heightInches = figureHeightInches(persons);
    if (heightInches >= 2.0 && heightInches <= 6.0) {
      score += 1;
      details.figure_appropriate_size = { score: 1, description: `Figure appropriate size (${heightInches.toFixed(1)} inches)`, keyword: '#Good_size' };
    }
  }

  // 9. grounded_figure — requires ground-line detection (scored 0)

  // 10. complete_person (has detectable person)
  if ((counts.person || 0) > 0) {
    score += 1;
    details.complete_person = { score: 1, description: 'Person is present', keyword: '#Person_present' };
  }

  // 11. facial_features — requires facial feature detection (scored 0)
  // 12. smiling — requires expression recognition (scored 0)
  // 13. movement — requires pose analysis (scored 0)
  // 14. sun_present — requires detection category (scored 0)
  // 15. flowers_nature — requires detection category (scored 0)

  // 16. multiple_resources
  const resourceCount = counts.umbrella || 0;
  if (resourceCount > 1) {
    score += 1;
    details.multiple_resources = { score: 1, description: `Multiple resources (${resourceCount})`, keyword: '#Multi_resources' };
  }

  // 17. detailed_drawing — requires qualitative analysis (scored 0)

  // 18. centered_figure
  if (persons.length > 0 && imageWidth > 0 && imageHeight > 0) {
    const mainPerson = persons.reduce((best, p) => (getArea(p) > getArea(best) ? p : best), persons[0]);
    const center = getCenter(mainPerson);
    const cx = imageWidth / 2;
    const cy = imageHeight / 2;
    const distFromCenter = Math.sqrt((center[0] - cx) ** 2 + (center[1] - cy) ** 2);
    const threshold = Math.min(imageWidth, imageHeight) * 0.25;
    if (distFromCenter < threshold) {
      score += 1;
      details.centered_figure = { score: 1, description: 'Figure is centered on page', keyword: '#Centered' };
    }
  }

  // 19. appropriate_proportions — requires skeleton analysis (scored 0)

  return { score, details };
}

// --------------- Interpretation ---------------

/**
 * 根據 total_score 給出整體解讀
 */
function getInterpretation(totalScore) {
  if (totalScore >= 4) return '資源充足，壓力因應能力良好 (Adequate resources, good coping ability)';
  if (totalScore >= 1) return '資源略多於壓力，因應能力尚可 (Slightly more resources than stress)';
  if (totalScore >= -1) return '壓力與資源大致平衡 (Stress and resources roughly balanced)';
  if (totalScore >= -4) return '壓力略多於資源，需關注因應策略 (Slightly more stress than resources)';
  return '壓力顯著高於資源，建議進一步評估 (Significantly more stress, further assessment recommended)';
}

// --------------- Main exported function ---------------

/**
 * 計算完整 DAPR 分數
 *
 * @param {Array<{category: string, bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number, confidence: number}>} detections
 * @param {number} imageWidth  圖片寬度 (px)
 * @param {number} imageHeight 圖片高度 (px)
 * @returns {{
 *   stress_score: number,
 *   resource_score: number,
 *   total_score: number,
 *   stress_items: Array,
 *   resource_items: Array,
 *   interpretation: string,
 *   attributes: { stress: Array, resource: Array }
 * }}
 */
function calculateDAPRScore(detections, imageWidth, imageHeight) {
  const objects = (detections || []).map((d) => ({
    category: d.category,
    bbox_x: d.bbox_x,
    bbox_y: d.bbox_y,
    bbox_w: d.bbox_w,
    bbox_h: d.bbox_h,
    confidence: d.confidence,
  }));

  const { score: stressScore, details: stressDetails } = calculateStressScore(objects);
  const { score: resourceScore, details: resourceDetails } = calculateResourceScore(objects, imageWidth, imageHeight);
  const totalScore = resourceScore - stressScore;

  // Build per-item arrays with full metadata for every defined item
  const stressItems = STRESS_ITEMS.map((item) => {
    const detail = stressDetails[item.name];
    return {
      name: item.name,
      category: 'stress',
      method: item.method,
      score: detail ? detail.score : 0,
      max_score: 1,
      description: item.description,
    };
  });

  const resourceItems = RESOURCE_ITEMS.map((item) => {
    const detail = resourceDetails[item.name];
    return {
      name: item.name,
      category: 'resource',
      method: item.method,
      score: detail ? detail.score : 0,
      max_score: 1,
      description: item.description,
    };
  });

  const stressAttributes = Object.values(stressDetails).map((v) => ({
    keyword: v.keyword,
    description: v.description,
    score: v.score,
  }));
  const resourceAttributes = Object.values(resourceDetails).map((v) => ({
    keyword: v.keyword,
    description: v.description,
    score: v.score,
  }));

  return {
    stress_score: stressScore,
    resource_score: resourceScore,
    total_score: totalScore,
    stress_items: stressItems,
    resource_items: resourceItems,
    interpretation: getInterpretation(totalScore),
    attributes: {
      stress: stressAttributes,
      resource: resourceAttributes,
    },
  };
}

export {
  calculateDAPRScore,
  // Expose internals for testing
  STRESS_ITEMS,
  RESOURCE_ITEMS,
  PIXELS_PER_INCH,
  EXCESS_RAIN_THRESHOLD,
  computeIoU,
  checkOverlap,
  calculateDistance,
  figureHeightInches,
  pixelsToInches,
  getInterpretation,
};
