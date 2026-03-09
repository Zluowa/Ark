from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw
from transformers import AutoModelForCausalLM, AutoProcessor


class DetectMaskRequest(BaseModel):
    image_path: str
    save_mask_path: str | None = None
    task_prompt: str = "<REGION_TO_SEGMENTATION>"
    text_input: str = "watermark"
    max_new_tokens: int = Field(default=1024, ge=16, le=4096)
    num_beams: int = Field(default=3, ge=1, le=8)


class DetectMaskBatchRequest(BaseModel):
    image_paths: list[str]
    output_dir: str | None = None
    task_prompt: str = "<REGION_TO_SEGMENTATION>"
    text_input: str = "watermark"
    max_new_tokens: int = Field(default=1024, ge=16, le=4096)
    num_beams: int = Field(default=3, ge=1, le=8)


class DetectMaskResponse(BaseModel):
    ok: bool = True
    image_path: str
    mask_path: str | None = None
    width: int
    height: int
    polygon_count: int
    coverage: float
    model_id: str
    device: str


class DetectMaskBatchResponse(BaseModel):
    ok: bool = True
    items: list[DetectMaskResponse]


class FlorenceWatermarkDetector:
    def __init__(self, model_id: str, device: str):
        self.model_id = model_id
        self.device = device
        dtype = torch.float16 if device == "cuda" else torch.float32
        self.model = (
            AutoModelForCausalLM.from_pretrained(
                model_id,
                trust_remote_code=True,
                torch_dtype=dtype,
            )
            .to(device)
            .eval()
        )
        self.processor = AutoProcessor.from_pretrained(
            model_id,
            trust_remote_code=True,
        )

    def _extract_polygons(
        self,
        image: Image.Image,
        task_prompt: str,
        text_input: str,
        max_new_tokens: int,
        num_beams: int,
    ) -> list[list[list[float]]]:
        inputs = self.processor(
            text=task_prompt + text_input,
            images=image,
            return_tensors="pt",
        ).to(self.device)
        generated_ids = self.model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=max_new_tokens,
            early_stopping=False,
            do_sample=False,
            num_beams=num_beams,
        )
        generated_text = self.processor.batch_decode(
            generated_ids,
            skip_special_tokens=False,
        )[0]
        parsed = self.processor.post_process_generation(
            generated_text,
            task=task_prompt,
            image_size=(image.width, image.height),
        )
        polygons = parsed.get(task_prompt)
        if not polygons or not isinstance(polygons, dict):
            return []
        return polygons.get("polygons", [])

    @staticmethod
    def _mask_from_polygons(
        image_size: tuple[int, int],
        polygons: list[list[list[float]]],
    ) -> tuple[Image.Image, int]:
        width, height = image_size
        mask = Image.new("L", image_size, 0)
        draw = ImageDraw.Draw(mask)
        polygon_count = 0
        for group in polygons:
            if not isinstance(group, list):
                continue
            for polygon in group:
                if not isinstance(polygon, list) or len(polygon) < 6:
                    continue
                arr = np.array(polygon, dtype=np.float32).reshape(-1, 2)
                if arr.shape[0] < 3:
                    continue
                clipped = arr.copy()
                clipped[:, 0] = np.clip(clipped[:, 0], 0, width)
                clipped[:, 1] = np.clip(clipped[:, 1], 0, height)
                draw.polygon(clipped.reshape(-1).tolist(), fill=255)
                polygon_count += 1
        return mask, polygon_count

    def detect(
        self,
        image_path: str,
        task_prompt: str,
        text_input: str,
        max_new_tokens: int,
        num_beams: int,
        save_mask_path: str | None = None,
    ) -> DetectMaskResponse:
        path = Path(image_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"image not found: {image_path}")

        image = Image.open(path).convert("RGB")
        polygons = self._extract_polygons(
            image=image,
            task_prompt=task_prompt,
            text_input=text_input,
            max_new_tokens=max_new_tokens,
            num_beams=num_beams,
        )
        mask, polygon_count = self._mask_from_polygons(image.size, polygons)
        mask_path: str | None = None
        if save_mask_path:
            target = Path(save_mask_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            mask.save(target)
            mask_path = str(target)
        coverage = float(np.asarray(mask, dtype=np.uint8).mean() / 255.0)
        return DetectMaskResponse(
            image_path=str(path),
            mask_path=mask_path,
            width=image.width,
            height=image.height,
            polygon_count=polygon_count,
            coverage=coverage,
            model_id=self.model_id,
            device=self.device,
        )


def build_app(model_id: str, device: str) -> FastAPI:
    detector = FlorenceWatermarkDetector(model_id=model_id, device=device)
    app = FastAPI()

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "model_id": model_id, "device": device}

    @app.post("/v1/detect-mask", response_model=DetectMaskResponse)
    def detect_mask(body: DetectMaskRequest) -> DetectMaskResponse:
        return detector.detect(
            image_path=body.image_path,
            task_prompt=body.task_prompt,
            text_input=body.text_input,
            max_new_tokens=body.max_new_tokens,
            num_beams=body.num_beams,
            save_mask_path=body.save_mask_path,
        )

    @app.post("/v1/detect-mask-batch", response_model=DetectMaskBatchResponse)
    def detect_mask_batch(body: DetectMaskBatchRequest) -> DetectMaskBatchResponse:
        items: list[DetectMaskResponse] = []
        output_dir = Path(body.output_dir) if body.output_dir else None
        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
        for image_path in body.image_paths:
            source = Path(image_path)
            save_mask_path = None
            if output_dir:
                save_mask_path = str(output_dir / f"{source.stem}-mask.png")
            items.append(
                detector.detect(
                    image_path=image_path,
                    task_prompt=body.task_prompt,
                    text_input=body.text_input,
                    max_new_tokens=body.max_new_tokens,
                    num_beams=body.num_beams,
                    save_mask_path=save_mask_path,
                )
            )
        return DetectMaskBatchResponse(items=items)

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17861)
    parser.add_argument(
        "--model-id",
        default="microsoft/Florence-2-large",
    )
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    app = build_app(model_id=args.model_id, device=args.device)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
