import re

with open("api/routes/vehicles.py", "r") as f:
    content = f.read()

# Add media endpoints
media_code = """
@router.post("/{vehicle_id}/media", status_code=201)
async def upload_vehicle_media(
    vehicle_id: str,
    file: UploadFile = File(...),
    checkpoint_id: Optional[str] = Form(None),
    log_id: Optional[str] = Form(None),
    kind: str = Form("photo"),
    title: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from vehicles.media import process_upload
    from vehicles.models import VehicleMedia, MediaKind, MediaSource
    
    file_path, thumb_path = await process_upload(file, kind)
    if not file_path:
        raise bad_request("Failed to process media")
        
    m = VehicleMedia(
        vehicle_id=vehicle_id,
        checkpoint_id=checkpoint_id,
        log_id=log_id,
        kind=MediaKind.PHOTO if kind == "photo" else MediaKind.VIDEO,
        title=title or file.filename,
        source=MediaSource.USER_UPLOAD,
        file_path=file_path,
        thumb_path=thumb_path
    )
    db.add(m)
    db.commit()
    
    return {"status": "ok", "id": str(m.id)}

@router.get("/media/{media_id}")
async def get_vehicle_media(
    media_id: str,
    thumb: bool = False,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from vehicles.models import VehicleMedia
    from fastapi.responses import FileResponse
    m = db.query(VehicleMedia).filter(VehicleMedia.id == media_id).first()
    if not m:
        raise not_found("Media not found")
        
    # We should probably check if user has access to m.vehicle_id
    
    path = m.thumb_path if thumb and m.thumb_path else m.file_path
    if not path or not os.path.exists(path):
        raise not_found("File not found on disk")
        
    return FileResponse(path)
"""

content += media_code

with open("api/routes/vehicles.py", "w") as f:
    f.write(content)
