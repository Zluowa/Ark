#!/usr/bin/env python3
"""Minimal DOCX helper for OmniAgent tools."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def extract_text(docx_path: pathlib.Path) -> tuple[str, int]:
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml_bytes = zf.read("word/document.xml")

    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []
    for node in root.findall(".//w:p", NS):
        pieces = [text.text for text in node.findall(".//w:t", NS) if text.text]
        if pieces:
            paragraphs.append("".join(pieces))

    content = "\n".join(paragraphs).strip()
    return content, len(paragraphs)


def main() -> int:
    parser = argparse.ArgumentParser(description="Word helper")
    parser.add_argument("--op", required=True, choices=["extract_text"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    src = pathlib.Path(args.input)
    out = pathlib.Path(args.output)

    if not src.exists():
        print(json.dumps({"ok": False, "code": "input_not_found", "message": f"Missing file: {src}"}))
        return 2

    try:
        if args.op == "extract_text":
            text, paragraph_count = extract_text(src)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")

            line_count = len([line for line in text.splitlines() if line.strip()])
            print(
                json.dumps(
                    {
                        "ok": True,
                        "data": {
                            "char_count": len(text),
                            "line_count": line_count,
                            "paragraph_count": paragraph_count,
                        },
                    }
                )
            )
            return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "code": "extract_failed", "message": str(exc)}))
        return 1

    print(json.dumps({"ok": False, "code": "invalid_op", "message": f"Unsupported op: {args.op}"}))
    return 2


if __name__ == "__main__":
    sys.exit(main())

