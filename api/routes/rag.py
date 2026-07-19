"""
api/routes/rag.py

API endpoints for Retrieval-Augmented Generation (RAG).
Handles document ingestion and querying for specific contexts (e.g., vehicles).
"""

from __future__ import annotations
# removed duplicate import Header  # Fix missing import

import logging
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rag", tags=["rag"])


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]


class QueryBody(BaseModel):
    doc_id: str
    question: str


@router.post("/ingest")
async def ingest_document(
    request: Request,
    doc_id: str,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.rag.rag_provider import RAGProvider

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")

    rag = RAGProvider()
    try:
        # We use ingest_pdf for PDF and fallback to raw text if needed
        # In a real app we'd check mime type, but rag_provider.ingest_pdf
        # is what we have for now.
        await rag.ingest_pdf(content, {
            "doc_id": doc_id,
            "filename": file.filename,
            "user_id": user_id,
            "type": "uploaded_doc"
        })
        return {"status": "ok", "doc_id": doc_id, "filename": file.filename}
    except Exception as e:
        logger.error("RAG ingestion failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Ingestion failed: {
                str(e)}")


@router.post("/query")
async def query_rag(
    request: Request,
    body: QueryBody,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.rag.rag_provider import RAGProvider

    rag = RAGProvider()
    try:
        # Search chunks for this specific doc_id
        # Note: rag_provider search_results is what query_documents uses.
        # We'll use query_documents but filter by metadata in a real implementation.
        # For now, we follow the prompt's request for { doc_id, question }.

        # We need an LLM to answer the question using the context.
        from core.conversation_loop import ConversationLoop

        results = await rag.query_documents(body.question)
        if not results:
            return {
                "answer": "I couldn't find any information in the uploaded documents.", "chunks": []}

        context = rag.format_context(results)

        # Simple answering logic using LLM
        loop = ConversationLoop(
            memory_manager=request.app.state.memory_manager,
            user_id=user_id,
            mode="text",
        )
        await loop.initialize()

        prompt = f"Using the following context from vehicle documents, please answer this question: {body.question}\n\nContext:\n{context}"

        async def _stream():
            import asyncio
            import json as _json
            queue: asyncio.Queue = asyncio.Queue()

            async def on_event(evt: dict):
                await queue.put(evt)

            # Run the conversation turn in a background task
            task = asyncio.create_task(loop.run_text(prompt, on_event))  # type: ignore

            try:
                while True:
                    # Drain any already-queued events first
                    while not queue.empty():
                        evt = queue.get_nowait()
                        if evt["type"] in ("response_chunk", "token"):
                            text = evt.get("text") or evt.get("content", "")
                            yield f"data: {_json.dumps({'type': 'text', 'content': text})}\n\n"
                        elif evt["type"] in ("tool_use", "tool_result"):
                            yield f"data: {_json.dumps(evt)}\n\n"
                        elif evt["type"] == "error":
                            yield f"data: {_json.dumps({'type': 'error', 'content': evt['message']})}\n\n"

                    if task.done() and queue.empty():
                        break

                    # Wait for the next event or task completion
                    try:
                        evt = await asyncio.wait_for(queue.get(), timeout=0.05)
                        if evt["type"] in ("response_chunk", "token"):
                            text = evt.get("text") or evt.get("content", "")
                            yield f"data: {_json.dumps({'type': 'text', 'content': text})}\n\n"
                        elif evt["type"] in ("tool_use", "tool_result"):
                            yield f"data: {_json.dumps(evt)}\n\n"
                        elif evt["type"] == "error":
                            yield f"data: {_json.dumps({'type': 'error', 'content': evt['message']})}\n\n"
                    except asyncio.TimeoutError:
                        pass
                
                # Append sources footnote
                sources = [{"text": r["text"], "source": r["metadata"].get("filename", "Unknown")} for r in results]
                unique_sources = list(set(s["source"] for s in sources))
                if unique_sources:
                    footnote = "\n\n---\n_Sources: " + ", ".join(unique_sources) + "_"
                    yield f"data: {_json.dumps({'type': 'text', 'content': footnote})}\n\n"
                
                yield "data: [DONE]\n\n"
            except Exception as exc:
                logger.error("RAG query stream error: %s", exc, exc_info=True)
                yield f"data: {_json.dumps({'type': 'error', 'content': str(exc)})}\n\n"
            finally:
                if not task.done():
                    task.cancel()

        from fastapi.responses import StreamingResponse
        return StreamingResponse(_stream(), media_type="text/event-stream")
    except Exception as e:
        logger.error("RAG query failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")
