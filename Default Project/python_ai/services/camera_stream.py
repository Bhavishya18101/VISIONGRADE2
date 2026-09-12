import cv2
import asyncio
import json
import base64
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass
from threading import Thread, Lock
import time

logger = logging.getLogger(__name__)

@dataclass
class CameraConfig:
    camera_id: str
    name: str
    source: int
    width: int = 1280
    height: int = 720
    fps: int = 30
    codec: str = 'MJPG'

class CameraStream:
    def __init__(self, config: CameraConfig):
        self.config = config
        self.cap: Optional[cv2.VideoCapture] = None
        self.running = False
        self.frame: Optional[bytes] = None
        self.frame_lock = Lock()
        self.latest_frame: Optional[bytes] = None
        self.fps = 0
        self.frame_count = 0
        self.last_fps_time = time.time()
        self.thread: Optional[Thread] = None

    def start(self) -> bool:
        try:
            self.cap = cv2.VideoCapture(self.config.source)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
            self.cap.set(cv2.CAP_PROP_FPS, self.config.fps)
            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.config.codec))
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not self.cap.isOpened():
                logger.error(f"Failed to open camera {self.config.camera_id}")
                return False

            self.running = True
            self.thread = Thread(target=self._capture_loop, daemon=True)
            self.thread.start()
            logger.info(f"Camera {self.config.camera_id} started")
            return True
        except Exception as e:
            logger.error(f"Camera start error: {e}")
            return False

    def _capture_loop(self):
        while self.running and self.cap and self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.01)
                continue

            self.frame_count += 1
            now = time.time()
            if now - self.last_fps_time >= 1.0:
                self.fps = self.frame_count
                self.frame_count = 0
                self.last_fps_time = now

            _, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            with self.frame_lock:
                self.frame = buffer.tobytes()

    def get_frame(self) -> Optional[bytes]:
        with self.frame_lock:
            return self.frame

    def get_frame_base64(self) -> Optional[str]:
        frame = self.get_frame()
        if frame:
            return base64.b64encode(frame).decode('utf-8')
        return None

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
        if self.cap:
            self.cap.release()
        logger.info(f"Camera {self.config.camera_id} stopped")

class CameraManager:
    def __init__(self):
        self.cameras: Dict[str, CameraStream] = {}
        self.lock = Lock()

    def add_camera(self, config: CameraConfig) -> bool:
        with self.lock:
            if config.camera_id in self.cameras:
                return False
            camera = CameraStream(config)
            if camera.start():
                self.cameras[config.camera_id] = camera
                return True
            return False

    def remove_camera(self, camera_id: str) -> bool:
        with self.lock:
            if camera_id in self.cameras:
                self.cameras[camera_id].stop()
                del self.cameras[camera_id]
                return True
            return False

    def get_camera(self, camera_id: str) -> Optional[CameraStream]:
        with self.lock:
            return self.cameras.get(camera_id)

    def get_all_cameras(self) -> List[CameraStream]:
        with self.lock:
            return list(self.cameras.values())

    def get_status(self) -> List[dict]:
        with self.lock:
            return [
                {
                    'cameraId': cam.config.camera_id,
                    'name': cam.config.name,
                    'status': 'active' if cam.running else 'inactive',
                    'resolution': f"{cam.config.width}x{cam.config.height}",
                    'fps': cam.fps,
                }
                for cam in self.cameras.values()
            ]

    def stop_all(self):
        with self.lock:
            for cam in self.cameras.values():
                cam.stop()
            self.cameras.clear()

camera_manager = CameraManager()

async def start_mjpeg_stream(camera_id: str, response):
    camera = camera_manager.get_camera(camera_id)
    if not camera:
        return

    response.headers['Content-Type'] = 'multipart/x-mixed-replace; boundary=frame'
    await response.prepare()

    try:
        while camera.running:
            frame = camera.get_frame()
            if frame:
                await response.write(b'--frame\r\n')
                await response.write(b'Content-Type: image/jpeg\r\n')
                await response.write(f'Content-Length: {len(frame)}\r\n\r\n'.encode())
                await response.write(frame)
                await response.write(b'\r\n')
            await asyncio.sleep(1/30)
    except Exception as e:
        logger.error(f"MJPEG stream error: {e}")
    finally:
        await response.write_eof()

def create_camera_routes(app):
    from aiohttp import web

    async def list_cameras(request):
        return web.json_response({'cameras': camera_manager.get_status()})

    async def get_camera(request):
        camera_id = request.match_info['camera_id']
        camera = camera_manager.get_camera(camera_id)
        if not camera:
            return web.json_response({'error': 'Camera not found'}, status=404)
        return web.json_response({
            'cameraId': camera.config.camera_id,
            'name': camera.config.name,
            'status': 'active' if camera.running else 'inactive',
            'resolution': f"{camera.config.width}x{camera.config.height}",
            'fps': camera.fps,
        })

    async def mjpeg_stream(request):
        camera_id = request.match_info['camera_id']
        camera = camera_manager.get_camera(camera_id)
        if not camera:
            return web.Response(text='Camera not found', status=404)

        response = web.StreamResponse()
        response.headers['Content-Type'] = 'multipart/x-mixed-replace; boundary=frame'
        await response.prepare(request)

        try:
            while camera.running:
                frame = camera.get_frame()
                if frame:
                    await response.write(b'--frame\r\n')
                    await response.write(b'Content-Type: image/jpeg\r\n')
                    await response.write(f'Content-Length: {len(frame)}\r\n\r\n'.encode())
                    await response.write(frame)
                    await response.write(b'\r\n')
                await asyncio.sleep(1/camera.config.fps)
        except Exception as e:
            logger.error(f"Stream error: {e}")
        finally:
            await response.write_eof()
        return response

    async def add_camera(request):
        data = await request.json()
        config = CameraConfig(
            camera_id=data['cameraId'],
            name=data['name'],
            source=data['source'],
            width=data.get('width', 1280),
            height=data.get('height', 720),
            fps=data.get('fps', 30),
        )
        if camera_manager.add_camera(config):
            return web.json_response({'success': True})
        return web.json_response({'error': 'Camera already exists'}, status=400)

    async def remove_camera(request):
        camera_id = request.match_info['camera_id']
        if camera_manager.remove_camera(camera_id):
            return web.json_response({'success': True})
        return web.json_response({'error': 'Camera not found'}, status=404)

    app.router.add_get('/api/cameras', list_cameras)
    app.router.add_get('/api/cameras/{camera_id}', get_camera)
    app.router.add_get('/api/cameras/{camera_id}/stream', mjpeg_stream)
    app.router.add_post('/api/cameras', add_camera)
    app.router.add_delete('/api/cameras/{camera_id}', remove_camera)

    return app

if __name__ == '__main__':
    from aiohttp import web

    app = web.Application()
    create_camera_routes(app)

    config = CameraConfig('cam0', 'Main Camera', 0)
    camera_manager.add_camera(config)

    web.run_app(app, host='0.0.0.0', port=8080)