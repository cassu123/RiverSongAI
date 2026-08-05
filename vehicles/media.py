import os
import uuid
import logging
import asyncio
from typing import Optional, Tuple
from fastapi import UploadFile
from PIL import Image

logger = logging.getLogger(__name__)
MEDIA_DIR = "data/vehicle_media"
os.makedirs(MEDIA_DIR, exist_ok=True)

async def process_upload(file: UploadFile, kind: str) -> Tuple[Optional[str], Optional[str]]:
    file_id = str(uuid.uuid4())
    content = await file.read()
    
    if kind == "photo":
        img_path = os.path.join(MEDIA_DIR, f"{file_id}.webp")
        thumb_path = os.path.join(MEDIA_DIR, f"{file_id}_thumb.webp")
        
        try:
            from io import BytesIO
            img = Image.open(BytesIO(content))
            if img.mode != "RGB":
                img = img.convert("RGB")
            
            # max 1920
            img.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            img.save(img_path, "WEBP", quality=85)
            
            # thumb
            img.thumbnail((320, 320), Image.Resampling.LANCZOS)
            img.save(thumb_path, "WEBP", quality=80)
            return img_path, thumb_path
        except Exception as e:
            logger.error(f"Image compression failed: {e}")
            return None, None
            
    elif kind == "video":
        import tempfile
        import shutil
        import subprocess
        
        raw_path = os.path.join(MEDIA_DIR, f"{file_id}_raw.mp4")
        out_path = os.path.join(MEDIA_DIR, f"{file_id}.mp4")
        thumb_path = os.path.join(MEDIA_DIR, f"{file_id}_thumb.jpg")
        
        with open(raw_path, "wb") as f:
            f.write(content)
            
        try:
            # check ffmpeg
            res = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
            if res.returncode == 0:
                # scale to 720p H.264
                subprocess.run([
                    "ffmpeg", "-i", raw_path,
                    "-vf", "scale=-2:720",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "28",
                    "-c:a", "aac", "-b:a", "128k",
                    "-y", out_path
                ], check=True, capture_output=True)
                
                # generate thumb
                subprocess.run([
                    "ffmpeg", "-i", out_path,
                    "-vframes", "1", "-vf", "scale=320:-2",
                    "-q:v", "5",
                    "-y", thumb_path
                ], check=True, capture_output=True)
                
                os.remove(raw_path)
                return out_path, thumb_path
            else:
                logger.warning("ffmpeg not found, saving video as-is")
                os.rename(raw_path, out_path)
                return out_path, None
        except Exception as e:
            logger.warning(f"ffmpeg conversion failed: {e}, saving video as-is")
            if os.path.exists(raw_path):
                os.rename(raw_path, out_path)
            return out_path, None
            
    return None, None
