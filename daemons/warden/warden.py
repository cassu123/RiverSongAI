import asyncio
import json
import logging
from daemons.base_daemon import BaseDaemon
from config.settings import get_settings

try:
    import cv2
    from ultralytics import YOLO
    VISION_DEPS_AVAILABLE = True
except ImportError:
    VISION_DEPS_AVAILABLE = False

logger = logging.getLogger(__name__)

class WardenDaemon(BaseDaemon):
    name = "warden"

    def __init__(self):
        super().__init__()
        self.settings = get_settings()
        self.yolo_model_name = self.settings.yolo_model
        self.yolo_confidence = self.settings.yolo_confidence
        self.yolo_device = self.settings.yolo_inference_device
        self.cameras = {}
        try:
            self.cameras = json.loads(self.settings.warden_rtsp_cameras)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse warden_rtsp_cameras: {e}")
        
        self.model = None

    async def _setup(self):
        if not self.settings.warden_enabled:
            logger.info("Warden daemon is disabled.")
            return False

        if not VISION_DEPS_AVAILABLE:
            logger.error("Vision dependencies (ultralytics, opencv-python) not installed.")
            return False

        try:
            logger.info(f"Loading YOLO model {self.yolo_model_name} on device {self.yolo_device}...")
            self.model = YOLO(self.yolo_model_name)
            logger.info("YOLO model loaded successfully.")
            return True
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            return False

    def _process_frame(self, frame, camera_name: str):
        if self.model is None:
            return

        try:
            # We run YOLO inference
            results = self.model(frame, conf=self.yolo_confidence, device=self.yolo_device, verbose=False)
            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    class_name = self.model.names[class_id]
                    conf = float(box.conf[0])
                    # Log detections
                    logger.info(f"[Warden] Camera '{camera_name}' detected {class_name} ({conf:.2f})")
        except Exception as e:
            logger.error(f"Inference error on camera {camera_name}: {e}")

    def _camera_loop_sync(self, name: str, url: str):
        logger.info(f"Starting capture loop for camera '{name}' at URL: {url}")
        cap = cv2.VideoCapture(url)
        
        if not cap.isOpened():
            logger.error(f"Failed to open stream for camera '{name}'")
            return

        # Skip frames to reduce CPU load (e.g. 1 frame processed per 30 captured)
        frame_skip = 30
        frame_count = 0

        while self._running:
            ret, frame = cap.read()
            if not ret:
                logger.warning(f"Failed to read from camera '{name}', retrying...")
                import time
                time.sleep(5)
                # Attempt to reconnect
                cap.release()
                cap = cv2.VideoCapture(url)
                if not cap.isOpened():
                    logger.error(f"Failed to reconnect camera '{name}'. Stopping loop.")
                    break
                continue
            
            frame_count += 1
            if frame_count % frame_skip == 0:
                self._process_frame(frame, name)

            import time
            time.sleep(0.01) # Yield a tiny bit

        cap.release()
        logger.info(f"Camera loop for '{name}' terminating.")

    async def _camera_task(self, name: str, url: str):
        loop = asyncio.get_running_loop()
        # Run blocking cv2/YOLO code in an executor thread
        await loop.run_in_executor(None, self._camera_loop_sync, name, url)

    async def _main_loop(self):
        setup_ok = await self._setup()
        if not setup_ok:
            while self._running:
                await asyncio.sleep(60)
            return

        active_cameras = {name: url for name, url in self.cameras.items() if url}
        if not active_cameras:
            logger.info("Warden daemon has no active cameras configured.")
            while self._running:
                await asyncio.sleep(60)
            return

        tasks = []
        for name, url in active_cameras.items():
            tasks.append(asyncio.create_task(self._camera_task(name, url)))

        try:
            # Wait until daemon stops or tasks finish
            while self._running:
                await asyncio.sleep(1)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            logger.info("Warden daemon main loop cleanly exited.")
