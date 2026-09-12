import cv2
import numpy as np
from typing import Tuple, Optional, List
import base64
from io import BytesIO
from PIL import Image

def resize_with_aspect(image: np.ndarray, target_size: Tuple[int, int], padding_color: Tuple[int, int, int] = (114, 114, 114)) -> np.ndarray:
    h, w = image.shape[:2]
    target_w, target_h = target_size

    scale = min(target_w / w, target_h / h)
    new_w, new_h = int(w * scale), int(h * scale)

    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    canvas = np.full((target_h, target_w, 3), padding_color, dtype=np.uint8)
    x_offset = (target_w - new_w) // 2
    y_offset = (target_h - new_h) // 2
    canvas[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized

    return canvas

def letterbox(image: np.ndarray, new_shape: Tuple[int, int] = (640, 640), color: Tuple[int, int, int] = (114, 114, 114), auto: bool = False, scale_fill: bool = False, scale_up: bool = True, stride: int = 32) -> np.ndarray:
    shape = image.shape[:2]
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)

    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    if not scale_up:
        r = min(r, 1.0)

    new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]

    if auto:
        dw, dh = np.mod(dw, stride), np.mod(dh, stride)
    elif scale_fill:
        dw, dh = 0, 0
        new_unpad = (new_shape[1], new_shape[0])
        r = new_shape[1] / shape[1], new_shape[0] / shape[0]

    dw /= 2
    dh /= 2

    if shape[::-1] != new_unpad:
        image = cv2.resize(image, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    image = cv2.copyMakeBorder(image, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)

    return image

def encode_image_base64(image: np.ndarray, format: str = 'JPEG', quality: int = 85) -> str:
    if format.upper() == 'JPEG':
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
        _, buffer = cv2.imencode('.jpg', image, encode_param)
    else:
        _, buffer = cv2.imencode('.png', image)

    return base64.b64encode(buffer).decode('utf-8')

def decode_image_base64(base64_string: str) -> np.ndarray:
    image_data = base64.b64decode(base64_string)
    nparr = np.frombuffer(image_data, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def draw_detections(image: np.ndarray, detections: List[dict], class_names: List[str], colors: List[Tuple[int, int, int]] = None) -> np.ndarray:
    annotated = image.copy()

    if colors is None:
        np.random.seed(42)
        colors = [tuple(map(int, np.random.randint(0, 255, 3))) for _ in range(len(class_names))]

    for det in detections:
        x1, y1, x2, y2 = map(int, det['bbox'])
        conf = det['confidence']
        cls = det['class']

        color = colors[cls % len(colors)]
        label = f"{class_names[cls]} {conf:.2f}"

        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        cv2.putText(annotated, label, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    return annotated

def calculate_iou(box1: Tuple[float, float, float, float], box2: Tuple[float, float, float, float]) -> float:
    x1_min, y1_min, x1_max, y1_max = box1
    x2_min, y2_min, x2_max, y2_max = box2

    inter_x_min = max(x1_min, x2_min)
    inter_y_min = max(y1_min, y2_min)
    inter_x_max = min(x1_max, x2_max)
    inter_y_max = min(y1_max, y2_max)

    if inter_x_max <= inter_x_min or inter_y_max <= inter_y_min:
        return 0.0

    inter_area = (inter_x_max - inter_x_min) * (inter_y_max - inter_y_min)
    box1_area = (x1_max - x1_min) * (y1_max - y1_min)
    box2_area = (x2_max - x2_min) * (y2_max - y2_min)

    return inter_area / (box1_area + box2_area - inter_area)

def non_max_suppression(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45, max_det: int = 300) -> np.ndarray:
    if len(boxes) == 0:
        return np.array([], dtype=int)

    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0 and len(keep) < max_det:
        i = order[0]
        keep.append(i)

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        inter = w * h

        iou = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[1:][iou <= iou_threshold]

    return np.array(keep, dtype=int)

def get_color_for_grade(grade: str) -> Tuple[int, int, int]:
    colors = {
        'Grade A': (0, 255, 0),
        'Grade B': (0, 255, 255),
        'Grade C': (255, 165, 0),
        'Rejected': (0, 0, 255),
    }
    return colors.get(grade, (255, 255, 255))

def estimate_weight_from_size(size_pixels: float, calibration_factor: float = 1.5) -> float:
    return size_pixels * calibration_factor

def assess_quality(detection: dict) -> dict:
    bbox = detection['bbox']
    conf = detection['confidence']

    x1, y1, x2, y2 = bbox
    width = x2 - x1
    height = y2 - y1
    aspect_ratio = width / height if height > 0 else 1
    size = (width + height) / 2

    color_score = min(conf * 1.2, 1.0)
    shape_score = 1.0 - min(abs(aspect_ratio - 1.0) * 0.5, 0.5)
    surface_score = conf
    size_score = min(size / 100, 1.0)

    return {
        'colorScore': round(color_score, 3),
        'shapeScore': round(shape_score, 3),
        'surfaceScore': round(surface_score, 3),
        'sizeScore': round(size_score, 3),
        'overall': round((color_score + shape_score + surface_score + size_score) / 4, 3),
    }