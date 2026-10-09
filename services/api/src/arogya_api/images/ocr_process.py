"""Isolated, bounded image decode and native OCR. Image/text never touch disk."""

import io
import json
import os
import subprocess
import sys
import warnings


def recognize(data, binary, directory, language, rotation):
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = 16_000_000
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "WEBP"]) as image:
            if (
                image.width * image.height > 16_000_000
                or max(image.size) > 12000
                or getattr(image, "n_frames", 1) != 1
            ):
                raise ValueError("image_limits")
            image.load()
            normalized = ImageOps.exif_transpose(image).convert("RGB")
            if rotation:
                normalized = normalized.rotate(-rotation, expand=True)
            output = io.BytesIO()
            normalized.save(output, format="PNG")
    command = [binary, "stdin", "stdout", "--tessdata-dir", directory, "-l", language]
    # Output is drained by communicate; the pixel/input limits bound recognition work.
    result = subprocess.run(
        command,
        input=output.getvalue(),
        capture_output=True,
        timeout=45,
        check=True,
        env={**os.environ, "OMP_THREAD_LIMIT": "2"},
    )
    text = result.stdout.decode("utf-8").strip()
    if len(text) > 30000:
        raise ValueError("text_limits")
    return text


def main():
    try:
        binary, directory, language, rotation = sys.argv[1:]
        data = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if not data or len(data) > 8 * 1024 * 1024:
            raise ValueError("image_limits")
        print(json.dumps({"text": recognize(data, binary, directory, language, int(rotation))}))
    except Exception:
        # Decoder and native stderr may include private metadata; never forward them.
        sys.exit(2)


if __name__ == "__main__":
    main()
