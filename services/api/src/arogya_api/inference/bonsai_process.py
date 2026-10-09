"""Isolated Prism/MLX runtime. Only JSON protocol leaves stdout; never writes inputs."""

import base64
import contextlib
import io
import json
import sys
import time
from pathlib import Path


def main():
    import mlx.core as mx

    profile = json.loads(Path(sys.argv[1]).read_text())
    pack = Path(profile["pack"])
    mx.set_memory_limit(14 * 1024**3)
    mx.set_cache_limit(1024**3)
    sys.path.insert(0, str(pack / "runtime"))
    with contextlib.redirect_stdout(sys.stderr):
        from mlx_vlm import stream_generate
        from mlx_vlm.prompt_utils import apply_chat_template
        from vision_artifact import chat_config, load_vl_model

        model, processor, config = load_vl_model(pack)
    print(json.dumps({"ready": True, "revision": profile["revision"]}), flush=True)
    for raw in sys.stdin:
        images = None
        try:
            request = json.loads(raw)
            started = time.monotonic()
            images = None
            if request.get("image"):
                from PIL import Image

                images = [Image.open(io.BytesIO(base64.b64decode(request["image"], validate=True)))]
            with contextlib.redirect_stdout(sys.stderr):
                prompt = apply_chat_template(
                    processor,
                    chat_config(config),
                    request["messages"],
                    num_images=1 if images else 0,
                    enable_thinking=False,
                )
                text = ""
                result = None
                for result in stream_generate(
                    model,
                    processor,
                    prompt,
                    image=images,
                    max_tokens=request["max_tokens"],
                    temperature=0.0,
                    prefill_step_size=256,
                    verbose=False,
                ):
                    text += result.text
                    if len(text) > 24000:
                        raise ValueError("output_limit")
                if not result or result.generation_tokens >= request["max_tokens"]:
                    raise ValueError("truncated_output")
            print(
                json.dumps(
                    {
                        "text": text,
                        "revision": profile["revision"],
                        "seconds": round(time.monotonic() - started, 3),
                        "peak_memory_bytes": mx.get_peak_memory(),
                        "active_memory_bytes": mx.get_active_memory(),
                    }
                ),
                flush=True,
            )
        except Exception:
            print(json.dumps({"error": "bonsai_generation_failed"}), flush=True)
        finally:
            if images:
                for image in images:
                    image.close()
            mx.clear_cache()


if __name__ == "__main__":
    main()
