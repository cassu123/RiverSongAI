from fastapi import FastAPI, APIRouter
app = FastAPI()
router = APIRouter()

@router.get("/schedules")
def get_schedules(): return "GET"

@router.post("/schedules")
def post_schedules(): return "POST"

app.include_router(router)
