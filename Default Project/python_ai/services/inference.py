import cv2
import numpy as np
from ultralytics import YOLO
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import time

@dataclass
class Detection:
    bbox: Tuple[int, int, int, int]
    confidence: float
    class_id: int
    grade: str
    grade_key: str
    size: float
    weight: float
    defects: List[str]

class OnionInference:
    def __init__(self, model_path: str, confidence_threshold: float = 0.5, iou_threshold: float = 0.45):
        self.model = YOLO(model_path)
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold

        self.agmark_grades = {
            'grade_a': {'min_size': 50, 'max_size': 70, 'color': (0, 255, 0), 'label': 'Grade A', 'price': 2500},
            'grade_b': {'min_size': 40, 'max_size': 50, 'color': (0, 255, 255), 'label': 'Grade B', 'price': 1800},
            'grade_c': {'min_size': 30, 'max_size': 40, 'color': (255, 165, 0), 'label': 'Grade C', 'price': 1200},
            'rejected': {'min_size': 0, 'max_size': 30, 'color': (0, 0, 255), 'label': 'Rejected', 'price': 0},
        }

    def classify_onion(self, bbox: Tuple[int, int, int, int], confidence: float) -> Tuple[str, float]:
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1
        size = (width + height) / 2

        weight_estimate = (size / 100) * 150

        if size >= self.agmark_grades['grade_a']['min_size']:
            return 'grade_a', weight_estimate
        elif size >= self.agmark_grades['grade_b']['min_size']:
            return 'grade_b', weight_estimate
        elif size >= self.agmark_grades['grade_c']['min_size']:
            return 'grade_c', weight_estimate
        else:
            return 'rejected', weight_estimate

    def detect(self, frame: np.ndarray) -> List[Detection]:
        start_time = time.time()

        results = self.model(
            frame,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            verbose=False
        )

        inference_time = (time.time() - start_time) * 1000
        detections = []

        for result in results:
            boxes = result.boxes
            if boxes is not None:
                for box in boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])

                    grade_key, weight = self.classify_onion((x1, y1, x2, y2), conf)

                    detection = Detection(
                        bbox=(x1, y1, x2, y2),
                        confidence=conf,
                        class_id=cls,
                        grade=self.agmark_grades[grade_key]['label'],
                        grade_key=grade_key,
                        size=(x2 - x1 + y2 - y1) / 2,
                        weight=weight,
                        defects=[],
                    )
                    detections.append(detection)

        return detections, inference_time

    def annotate_frame(self, frame: np.ndarray, detections: List[Detection]) -> np.ndarray:
        annotated = frame.copy()

        for det in detections:
            grade_info = self.agmark_grades[det.grade_key]
            color = grade_info['color']
            label = f"{grade_info['label']} {det.confidence:.2f}"

            x1, y1, x2, y2 = det.bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(annotated, label, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

            size_label = f"{det.size:.0f}px | {det.weight:.0f}g"
            cv2.putText(annotated, size_label, (x1, y2 + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        return annotated

    def get_stats(self, detections: List[Detection]) -> Dict:
        stats = {k: 0 for k in self.agmark_grades.keys()}
        stats['total_weight'] = 0
        stats['avg_confidence'] = 0

        if not detections:
            return stats

        for det in detections:
            stats[det.grade_key] += 1
            stats['total_weight'] += det.weight
            stats['avg_confidence'] += det.confidence

        stats['avg_confidence'] /= len(detections)

        return stats

    def process_video_stream(self, source: int = 0, callback=None):
        cap = cv2.VideoCapture(source)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                detections, inference_time = self.detect(frame)
                annotated = self.annotate_frame(frame, detections)
                stats = self.get_stats(detections)

                if callback:
                    callback(frame, annotated, detections, stats, inference_time)

                cv2.imshow('Onion Grading', annotated)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
        finally:
            cap.release()
            cv2.destroyAllWindows()

def create_grader(model_path: str = 'models/best.pt') -> OnionInference:
    return OnionInference(model_path)

if __name__ == '__main__':
    grader = create_grader()

    def callback(orig, annotated, detections, stats, inf_time):
        print(f"Detections: {len(detections)} | Stats: {stats} | Inference: {inf_time:.1f}ms")

    grader.process_video_stream(0, callback)