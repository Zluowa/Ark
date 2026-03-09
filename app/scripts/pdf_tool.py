#!/usr/bin/env python3
"""PDF helper for OmniAgent tools.

Operations:
- compress
- merge
- split
- to_image
- page_count
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
    raise SystemExit(exit_code)


try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    emit(
        {
            "ok": False,
            "code": "dependency_missing",
            "message": f"PyMuPDF (fitz) unavailable: {exc}",
        },
        2,
    )


def op_compress(input_path: str, output_path: str, quality: int) -> dict[str, Any]:
    quality = max(1, min(100, int(quality)))
    with fitz.open(input_path) as doc:
        # PyMuPDF does not expose direct JPEG quality in save API.
        doc.save(
            output_path,
            garbage=4,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            clean=True,
        )
    return {
        "quality_hint": quality,
        "engine": "pymupdf",
    }


def op_merge(inputs: list[str], output_path: str) -> dict[str, Any]:
    out = fitz.open()
    inserted = 0
    try:
        for path in inputs:
            with fitz.open(path) as src:
                out.insert_pdf(src)
                inserted += src.page_count
        out.save(
            output_path,
            garbage=3,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            clean=True,
        )
    finally:
        out.close()
    return {
        "merged_pages": inserted,
        "engine": "pymupdf",
    }


def op_split(
    input_path: str,
    output_path: str,
    from_page: int,
    to_page: int,
) -> dict[str, Any]:
    with fitz.open(input_path) as src:
        total = src.page_count
        if total <= 0:
            raise ValueError("Source PDF has no pages")

        from_page = max(1, min(total, int(from_page)))
        to_page = max(from_page, min(total, int(to_page)))

        out = fitz.open()
        try:
            out.insert_pdf(src, from_page=from_page - 1, to_page=to_page - 1)
            out.save(
                output_path,
                garbage=3,
                deflate=True,
                deflate_images=True,
                deflate_fonts=True,
                clean=True,
            )
        finally:
            out.close()

    return {
        "from_page": from_page,
        "to_page": to_page,
        "engine": "pymupdf",
    }


def op_to_image(input_path: str, output_path: str, page: int, dpi: int) -> dict[str, Any]:
    page = max(1, int(page))
    dpi = max(72, min(600, int(dpi)))

    with fitz.open(input_path) as src:
        total = src.page_count
        if page > total:
            raise ValueError(f"Page out of range: {page}, total {total}")

        pix = src.load_page(page - 1).get_pixmap(dpi=dpi, alpha=False)
        pix.save(output_path)

    return {
        "page": page,
        "dpi": dpi,
        "engine": "pymupdf",
    }


def op_page_count(input_path: str) -> dict[str, Any]:
    with fitz.open(input_path) as src:
        return {
            "page_count": src.page_count,
            "engine": "pymupdf",
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--op",
        required=True,
        choices=["compress", "merge", "split", "to_image", "page_count"],
    )
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--inputs-json")
    parser.add_argument("--quality", type=int, default=75)
    parser.add_argument("--from-page", dest="from_page", type=int, default=1)
    parser.add_argument("--to-page", dest="to_page", type=int, default=1)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--dpi", type=int, default=150)
    return parser.parse_args()


def ensure_file(path: str, label: str) -> None:
    if not path:
        raise ValueError(f"Missing {label}")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"{label} not found: {path}")


def main() -> None:
    args = parse_args()

    try:
        if args.op == "compress":
            ensure_file(args.input, "input")
            if not args.output:
                raise ValueError("Missing output")
            data = op_compress(args.input, args.output, args.quality)
            emit({"ok": True, "data": data})

        if args.op == "merge":
            if not args.inputs_json:
                raise ValueError("Missing inputs-json")
            if not args.output:
                raise ValueError("Missing output")

            inputs = json.loads(args.inputs_json)
            if not isinstance(inputs, list) or len(inputs) < 2:
                raise ValueError("Need at least two inputs")

            for idx, path in enumerate(inputs):
                ensure_file(path, f"input[{idx}]")
            data = op_merge(inputs, args.output)
            emit({"ok": True, "data": data})

        if args.op == "split":
            ensure_file(args.input, "input")
            if not args.output:
                raise ValueError("Missing output")
            data = op_split(args.input, args.output, args.from_page, args.to_page)
            emit({"ok": True, "data": data})

        if args.op == "to_image":
            ensure_file(args.input, "input")
            if not args.output:
                raise ValueError("Missing output")
            data = op_to_image(args.input, args.output, args.page, args.dpi)
            emit({"ok": True, "data": data})

        if args.op == "page_count":
            ensure_file(args.input, "input")
            data = op_page_count(args.input)
            emit({"ok": True, "data": data})

        raise ValueError(f"Unsupported op: {args.op}")
    except Exception as exc:
        emit(
            {
                "ok": False,
                "code": "pdf_op_failed",
                "message": str(exc),
            },
            1,
        )


if __name__ == "__main__":
    main()
