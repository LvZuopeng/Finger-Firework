export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmarkerResult {
  landmarks: Coordinate[][];
  worldLandmarks: Coordinate[][];
  handedness: { index: number; score: number; displayName: string; categoryName: string }[][];
}

export enum HandLandmark {
  THUMB_TIP = 4,
  INDEX_FINGER_TIP = 8,
}
