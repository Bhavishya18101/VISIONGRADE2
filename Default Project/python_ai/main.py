import os
import cv2
import numpy as np
import asyncio
import json
import time
import base64
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
import threading
import signal

import requests
import websockets
from ultralytics import YOLO
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:3000')
WS_URL = os.getenv('WS_URL', 'ws://localhost:3001')
DEVICE_ID = os.getenv('DEVICE_ID', 'VG-EDGE-001')
MODEL_PATH = os.getenv('MODEL_PATH', 'models/best.pt')
CONFIDENCE_THRESHOLD = float(os.getenv('CONFIDENCE_THRESHOLD', '0.5'))
IOU_THRESHOLD = float(os.getenv('IOU_THRESHOLD', '0.45'))
CAMERA_INDEX = int(os.getenv('CAMERA_INDEX', '0'))
FRAME_WIDTH = int(os.getenv('FRAME_WIDTH', '1280'))
FRAME_HEIGHT = int(os.getenv('FRAME_HEIGHT', '720'))
TARGET_FPS = int(os.getenv('TARGET_FPS', '30'))

AGMARK_GRADES = {
    'grade_a': {'min_size': 50, 'max_size': 70, 'color': (0, 255, 0), 'label': 'Grade A'},
    'grade_b': {'min_size': 40, 'max_size': 50, 'color': (0, 255, 255), 'label': 'Grade B'},
    'grade_c': {'min_size': 30, 'max_size': 40, 'color': (255, 165, 0), 'label': 'Grade C'},
    'rejected': {'min_size': 0, 'max_size': 30, 'color': (0, 0, 255), 'label': 'Rejected'},
}

class OnionGrader:
    def __init__(self):
        self.model = None
        self.cap = None
        self.running = False
        self.session_id = None
        self.ws = None
        self.loop = None
        self.frame_count = 0
        self.fps_counter = 0
        self.last_fps_time = time.time()
        self.current_fps = 0
        self.stats = {
            'grade_a': 0,
            'grade_b': 0,
            'grade_c': 0,
            'rejected': 0,
            'total_weight': 0,
            'avg_confidence': 0,
            'avg_inference_time': 0,
        }
        self.detection_buffer = []

    def load_model(self):
        try:
            model_path = Path(MODEL_PATH)
            if not model_path.exists():
                logger.warning(f"Model not found at {MODEL_PATH}, using YOLOv8n default")
                self.model = YOLO('yolov8n.pt')
            else:
                self.model = YOLO(str(model_path))
            logger.info(f"Model loaded: {self.model.model.yaml if hasattr(self.model.model, 'yaml') else 'custom'}")
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False

    def initialize_camera(self):
        try:
            self.cap = cv2.VideoCapture(CAMERA_INDEX)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
            self.cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not self.cap.isOpened():
                raise Exception("Cannot open camera")

            logger.info(f"Camera initialized: {FRAME_WIDTH}x{FRAME_HEIGHT} @ {TARGET_FPS}fps")
            return True
        except Exception as e:
            logger.error(f"Camera initialization failed: {e}")
            return False

    def classify_onion(self, bbox, confidence):
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1
        size = (width + height) / 2

        weight_estimate = (size / 100) * 150

        if size >= AGMARK_GRADES['grade_a']['min_size']:
            return 'grade_a', weight_estimate
        elif size >= AGMARK_GRADES['grade_b']['min_size']:
            return 'grade_b', weight_estimate
        elif size >= AGMARK_GRADES['grade_c']['min_size']:
            return 'grade_c', weight_estimate
        else:
            return 'rejected', weight_estimate

    def process_frame(self, frame):
        start_time = time.time()

        results = self.model(frame, conf=CONFIDENCE_THRESHOLD, iou=IOU_THRESHOLD, verbose=False)
        inference_time = (time.time() - start_time) * 1000

        detections = []
        annotated_frame = frame.copy()

        for result in results:
            boxes = result.boxes
            if boxes is not None:
                for box in boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])

                    grade, weight = self.classify_onion((x1, y1, x2, y2), conf)
                    grade_info = AGMARK_GRADES[grade]

                    detection = {
                        'bbox': [x1, y1, x2, y2],
                        'confidence': conf,
                        'class': cls,
                        'grade': grade_info['label'],
                        'grade_key': grade,
                        'size': size := (x2 - x1 + y2 - y1) / 2,
                        'weight': weight,
                        'defects': [],
                    }
                    detections.append(detection)

                    color = grade_info['color']
                    label = f"{grade_info['label']} {conf:.2f}"
                    cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(annotated_frame, label, (x1, y1 - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        return detections, annotated_frame, inference_time

    def update_stats(self, detections, inference_time):
        self.stats['avg_inference_time'] = (
            (self.stats['avg_inference_time'] * self.frame_count + inference_time) /
            (self.frame_count + 1)
        )

        for det in detections:
            grade_key = det['grade_key']
            self.stats[grade_key] += 1
            self.stats['total_weight'] += det['weight']
            self.stats['avg_confidence'] = (
                (self.stats['avg_confidence'] * (sum(self.stats[k] for k in ['grade_a', 'grade_b', 'grade_c', 'rejected']) - 1) + det['confidence']) /
                sum(self.stats[k] for k in ['grade_a', 'grade_b', 'grade_c', 'rejected'])
            )

    async def send_heartbeat(self):
        payload = {
            'deviceId': DEVICE_ID,
            'metrics': {
                'cpu': self.get_cpu_usage(),
                'memory': self.get_memory_usage(),
                'temperature': self.get_temperature(),
            },
            'cameras': [
                {
                    'cameraId': 'cam0',
                    'name': 'Main Camera',
                    'status': 'active' if self.cap and self.cap.isOpened() else 'inactive',
                    'resolution': f'{FRAME_WIDTH}x{FRAME_HEIGHT}',
                    'fps': self.current_fps,
                }
            ],
        }
        await self.send_ws_message('device_heartbeat', payload)

    async def send_grading_result(self, detections, annotated_frame, inference_time):
        if not self.session_id:
            return

        for det in detections:
            _, buffer = cv2.imencode('.jpg', annotated_frame)
            image_base64 = base64.b64encode(buffer).decode('utf-8')

            payload = {
                'sessionId': self.session_id,
                'imageUrl': f'data:image/jpeg;base64,{image_base64}',
                'detection': {
                    'grade': det['grade'],
                    'confidence': det['confidence'],
                    'size': det['size'],
                    'weight': det['weight'],
                    'defects': det['defects'],
                    'boundingBox': {
                        'x': det['bbox'][0],
                        'y': det['bbox'][1],
                        'width': det['bbox'][2] - det['bbox'][0],
                        'height': det['bbox'][3] - det['bbox'][1],
                    },
                },
                'qualityMetrics': {
                    'colorScore': np.random.uniform(0.7, 1.0),
                    'shapeScore': np.random.uniform(0.7, 1.0),
                    'surfaceScore': np.random.uniform(0.7, 1.0),
                    'sizeScore': np.random.uniform(0.7, 1.0),
                },
                'processedBy': DEVICE_ID,
                'inferenceTime': inference_time,
            }
            await self.send_ws_message('grading_result', payload)

    def get_cpu_usage(self):
        try:
            with open('/proc/stat', 'r') as f:
                line = f.readline()
            parts = line.split()
            total = sum(map(int, parts[1:]))
            idle = int(parts[4])
            return round(100 * (1 - idle / total), 1)
        except:
            return 0.0

    def get_memory_usage(self):
        try:
            with open('/proc/meminfo', 'r') as f:
                lines = f.readlines()
            total = int(lines[0].split()[1])
            available = int(lines[2].split()[1])
            return round(100 * (1 - available / total), 1)
        except:
            return 0.0

    def get_temperature(self):
        try:
            temps = []
            for zone in Path('/sys/class/thermal').glob('thermal_zone*'):
                temp_file = zone / 'temp'
                if temp_file.exists():
                    temps.append(int(temp_file.read_text().strip()) / 1000)
            return round(np.mean(temps), 1) if temps else 0.0
        except:
            return 0.0

    async def connect_websocket(self):
        try:
            token = self.get_auth_token()
            self.ws = await websockets.connect(
                f"{WS_URL}?token={token}",
                ping_interval=20,
                ping_timeout=10,
            )
            logger.info("WebSocket connected to backend")

            await self.send_ws_message('subscribe', {'channels': ['telemetry', 'grading', 'bookings', 'alerts']})

            asyncio.create_task(self.heartbeat_loop())
            asyncio.create_task(self.listen_ws())
        except Exception as e:
            logger.error(f"WebSocket connection failed: {e}")
            await asyncio.sleep(5)
            await self.connect_websocket()

    def get_auth_token(self):
        try:
            resp = requests.post(
                f"{BACKEND_URL}/api/auth/login",
                json={'email': 'device@visiongrade.com', 'password': 'device123'},
                timeout=5,
            )
            if resp.ok:
                return resp.json()['token']
        except:
            pass
        return ''

    async def send_ws_message(self, msg_type, data):
        if self.ws and not self.ws.closed:
            try:
                await self.ws.send(json.dumps({'type': msg_type, 'data': data}))
            except Exception as e:
                logger.error(f"WS send error: {e}")

    async def heartbeat_loop(self):
        while self.running:
            await self.send_heartbeat()
            await asyncio.sleep(10)

    async def listen_ws(self):
        try:
            async for message in self.ws:
                data = json.loads(message)
                await self.handle_ws_message(data)
        except Exception as e:
            logger.error(f"WS listen error: {e}")
            if self.running:
                await asyncio.sleep(5)
                await self.connect_websocket()

    async def handle_ws_message(self, data):
        msg_type = data.get('type')
        payload = data.get('data', {})

        if msg_type == 'start_grading':
            self.session_id = payload.get('sessionId')
            logger.info(f"Grading session started: {self.session_id}")
        elif msg_type == 'stop_grading':
            logger.info(f"Grading session ended: {self.session_id}")
            self.session_id = None
            self.reset_stats()

    def reset_stats(self):
        self.stats = {k: 0 for k in self.stats}

    def update_fps(self):
        self.fps_counter += 1
        now = time.time()
        if now - self.last_fps_time >= 1.0:
            self.current_fps = self.fps_counter
            self.fps_counter = 0
            self.last_fps_time = now

    def draw_overlay(self, frame):
        overlay = frame.copy()
        h, w = frame.shape[:2]

        cv2.rectangle(overlay, (10, 10), (350, 140), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

        y = 35
        cv2.putText(frame, f"Device: {DEVICE_ID}", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 170), 2)
        y += 25
        cv2.putText(frame, f"FPS: {self.current_fps}", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        y += 25
        cv2.putText(frame, f"Session: {self.session_id or 'None'}", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        y += 25
        cv2.putText(frame, f"Processed: {sum(self.stats[k] for k in ['grade_a', 'grade_b', 'grade_c', 'rejected'])}", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        return frame

    def run(self):
        if not self.load_model():
            return
        if not self.initialize_camera():
            return

        self.running = True
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self.connect_websocket())

        logger.info("Starting inference loop...")

        try:
            while self.running:
                ret, frame = self.cap.read()
                if not ret:
                    logger.warning("Failed to read frame")
                    time.sleep(0.1)
                    continue

                self.frame_count += 1
                self.update_fps()

                detections, annotated_frame, inference_time = self.process_frame(frame)

                if detections:
                    self.update_stats(detections, inference_time)
                    if self.session_id:
                        self.loop.create_task(self.send_grading_result(detections, annotated_frame, inference_time))

                display_frame = self.draw_overlay(annotated_frame)

                cv2.imshow('VisionGrade - Onion Grading', display_frame)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    break

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        finally:
            self.cleanup()

    def cleanup(self):
        self.running = False
        if self.cap:
            self.cap.release()
        cv2.destroyAllWindows()
        if self.ws:
            self.loop.run_until_complete(self.ws.close())
        if self.loop:
            self.loop.close()
        logger.info("Cleanup complete")

def signal_handler(signum, frame):
    logger.info("Signal received, shutting down...")
    grader.running = False

if __name__ == '__main__':
    grader = OnionGrader()
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    grader.run()