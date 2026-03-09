from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def add_source_root(source_root: str) -> Path:
    root = Path(source_root).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"IOPaint source root not found: {root}")
    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
    return root


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17860)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--model", default="lama")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--interactive-seg-model", default="sam2_1_tiny")
    parser.add_argument("--remove-bg-model", default="briaai/RMBG-1.4")
    parser.add_argument("--realesrgan-model", default="realesr-general-x4v3")
    parser.add_argument("--enable-interactive-seg", action="store_true")
    parser.add_argument("--enable-remove-bg", action="store_true")
    parser.add_argument("--enable-anime-seg", action="store_true")
    parser.add_argument("--enable-realesrgan", action="store_true")
    parser.add_argument("--enable-gfpgan", action="store_true")
    parser.add_argument("--enable-restoreformer", action="store_true")
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args()

    add_source_root(args.source_root)

    from fastapi import FastAPI
    from iopaint.api import Api
    from iopaint.runtime import check_device, dump_environment_info, setup_model_dir
    from iopaint.schema import (
        ApiConfig,
        Device,
        InteractiveSegModel,
        RealESRGANModel,
        RemoveBGModel,
    )

    if args.local_files_only:
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_OFFLINE"] = "1"

    dump_environment_info()

    model_dir = setup_model_dir(Path(args.model_dir))
    output_dir = (
      Path(args.output_dir).expanduser().resolve()
      if args.output_dir.strip()
      else (model_dir / "outputs")
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    device = check_device(Device(args.device))

    config = ApiConfig(
        host=args.host,
        port=args.port,
        inbrowser=False,
        model=args.model,
        no_half=device != Device.cuda,
        low_mem=device != Device.cuda,
        cpu_offload=device != Device.cuda,
        disable_nsfw_checker=True,
        local_files_only=args.local_files_only,
        cpu_textencoder=False,
        device=device,
        input=None,
        mask_dir=None,
        output_dir=output_dir,
        quality=100,
        enable_interactive_seg=args.enable_interactive_seg,
        interactive_seg_model=InteractiveSegModel(args.interactive_seg_model),
        interactive_seg_device=device,
        enable_remove_bg=args.enable_remove_bg,
        remove_bg_device=device,
        remove_bg_model=RemoveBGModel(args.remove_bg_model),
        enable_anime_seg=args.enable_anime_seg,
        enable_realesrgan=args.enable_realesrgan,
        realesrgan_device=device,
        realesrgan_model=RealESRGANModel(args.realesrgan_model),
        enable_gfpgan=args.enable_gfpgan,
        gfpgan_device=device,
        enable_restoreformer=args.enable_restoreformer,
        restoreformer_device=device,
    )

    app = FastAPI()
    api = Api(app, config)
    api.launch()


if __name__ == "__main__":
    main()
