"""
Signal Coverage Prediction API

This FastAPI application provides endpoints to predict radio signal coverage
using the ITM (Irregular Terrain Model) via SPLAT! (https://github.com/jmcmellen/splat).

Endpoints:
    - /: landing page.
    - /predict: Accepts a signal coverage prediction request and starts a background task.
    - /result/{task_id}: Retrieves the status or result (GeoTIFF file) of a given prediction task.
"""

import redis
from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse
from uuid import uuid4
from app.services.splat import Splat
from app.models.CoveragePredictionRequest import CoveragePredictionRequest
import logging
import io

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Redis client for binary data
redis_client = redis.StrictRedis(host="localhost", port=6379, decode_responses=False)

# Initialize SPLAT service
splat_service = Splat(splat_path="/Users/patrick/Dev/splat")

# Initialize FastAPI app
app = FastAPI()

def run_splat(task_id: str, request: CoveragePredictionRequest):
    """
    Execute the SPLAT! coverage prediction and store the resulting GeoTIFF data in Redis.

    Args:
        task_id (str): UUID identifier for the task.
        request (CoveragePredictionRequest): The parameters for the SPLAT! prediction.

    Workflow:
        - Runs the SPLAT! coverage prediction.
        - Stores the resulting GeoTIFF data and the task status ("completed") in Redis.
        - On failure, stores the task status as "failed" and logs the error in Redis.

    Raises:
        Exception: If SPLAT! fails during execution.
    """
    try:
        logger.info(f"Starting SPLAT! coverage prediction for task {task_id}.")
        geotiff_data = splat_service.coverage_prediction(request)

        # Log before storing in Redis
        logger.info(f"Storing result in Redis for task {task_id}")
        redis_client.setex(task_id, 3600, geotiff_data)
        redis_client.setex(f"{task_id}:status", 3600, "completed")
        logger.info(f"Task {task_id} marked as completed.")
    except Exception as e:
        logger.error(f"Error in SPLAT! task {task_id}: {e}")
        redis_client.setex(f"{task_id}:status", 3600, "failed")
        redis_client.setex(f"{task_id}:error", 3600, str(e))
        raise


@app.post("/predict")
async def predict(payload: CoveragePredictionRequest, background_tasks: BackgroundTasks) -> JSONResponse:
    """
    Predict signal coverage using SPLAT!.
    Accepts a CoveragePredictionRequest and processes it in the background.

    - Generates a unique task ID.
    - Sets the initial task status to "processing" in Redis.
    - Adds the `run_splat` function to the background task queue.

    Args:
        payload (CoveragePredictionRequest): The parameters required for the SPLAT! coverage prediction.
        background_tasks (BackgroundTasks): FastAPI background tasks.

    Returns:
        JSONResponse: A response containing the unique task ID to track the prediction progress.
    """
    task_id = str(uuid4())
    redis_client.setex(f"{task_id}:status", 3600, "processing")
    background_tasks.add_task(run_splat, task_id, payload)
    return JSONResponse({"task_id": task_id})


@app.get("/result/{task_id}")
async def get_result(task_id: str):
    """
    Retrieve task status or GeoTIFF result.

    - Checks the task status in Redis.
    - If "completed," retrieves the GeoTIFF data and serves it as a downloadable file.
    - If "failed," returns the error message stored in Redis.
    - If "processing", indicate the same in the response.

    Args:
        task_id (str): The unique identifier for the task.

    Returns:
        JSONResponse: Task status if the task is still "processing" or "failed."
        StreamingResponse: A downloadable GeoTIFF file if the task is "completed."
    """
    status = redis_client.get(f"{task_id}:status")
    if not status:
        logger.warning(f"Task {task_id} not found in Redis.")
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if status == b"completed":
        # Get the GeoTIFF binary data
        geotiff_data = redis_client.get(task_id)

        # Create an in-memory file object
        geotiff_file = io.BytesIO(geotiff_data)

        # Return the GeoTIFF as a streaming response
        return StreamingResponse(
            geotiff_file,
            media_type="image/tiff",
            headers={"Content-Disposition": f"attachment; filename={task_id}.tif"}
        )

    elif status == b"failed":
        error = redis_client.get(f"{task_id}:error")
        return JSONResponse({"status": "failed", "error": error.decode("utf-8")})

    logger.info(f"Task {task_id} is still processing.")
    return JSONResponse({"status": "processing"})
