"""Recites a post in the page owner's voice with AI4Bharat IndicF5 (MIT), cloned from a short reference clip.

Usage:
  python scripts/voice/speak.py --script script.json --ref-audio reference.wav --ref-text "…" --out voice.wav

script.json: {"segments": [{"text": "देवनागरी", "slide": 1, "speed": 0.8, "pause": 1.0, "gain": 2}, …]}
Each segment is spoken on its own at its own pace (a title slower and stronger, poem lines like a recited
sher), followed by its pause. Writes the voice and <out>.json with when each slide's part starts and ends,
and each segment starts and ends, so the Reel shows each slide (or line) while it is spoken. The reference clip (≤ 15 s) and its exact transcript
decide the voice. Needs HF_TOKEN (the model is gated: accept its terms on huggingface.co once).
"""

import argparse
import json
import sys
import time

import numpy as np
import soundfile as sf
import torch
import torchaudio
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
from transformers import AutoModel

REPO = "ai4bharat/IndicF5"
RATE = 24000


def _load_audio(path, *args, **kwargs):
    # Recent torchaudio reads files only through the optional torchcodec package; the reference is a WAV,
    # which soundfile reads directly.
    data, rate = sf.read(path, dtype="float32", always_2d=True)
    return torch.from_numpy(data.T.copy()), rate


torchaudio.load = _load_audio

from f5_tts.infer.utils_infer import infer_process, preprocess_ref_audio_text  # noqa: E402  (after the patch)


def load_model():
    model = AutoModel.from_pretrained(REPO, trust_remote_code=True)
    # transformers renames "gamma"/"beta" parameters on load, which leaves some IndicF5 weights random;
    # load the checkpoint again by its exact names so every weight is the trained one.
    weights = load_file(hf_hub_download(REPO, "model.safetensors"))
    missing, _ = model.load_state_dict(weights, strict=False)
    if missing:
        raise SystemExit(f"IndicF5 weights missing after load: {missing[:5]}")
    return model


def trim(audio, threshold=0.01):
    """Cuts leading/trailing near-silence so the pauses are exactly the ones in the script."""
    loud = np.where(np.abs(audio) > threshold)[0]
    return audio[max(0, loud[0] - 1200): loud[-1] + 2400] if len(loud) else audio


def pick_device(name):
    if name != "auto":
        return name
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--ref-text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--nfe", type=int, default=64)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    with open(args.script, encoding="utf-8") as f:
        segments = json.load(f)["segments"]
    started = time.time()
    torch.manual_seed(args.seed)
    device = pick_device(args.device)
    model = load_model()
    model.ema_model.to(device)
    model.vocoder.to(device)
    ref_audio, ref_text = preprocess_ref_audio_text(args.ref_audio, args.ref_text, show_info=lambda *a: None)

    pieces, slides, timeline, cursor = [], {}, [], 0
    for seg in segments:
        audio, _, _ = infer_process(
            ref_audio, ref_text, seg["text"], model.ema_model, model.vocoder,
            mel_spec_type="vocos", nfe_step=args.nfe, speed=seg.get("speed", 0.9), device=device,
            show_info=lambda *a: None,
        )
        audio = trim(np.asarray(audio, dtype=np.float32)) * (10 ** (seg.get("gain", 0) / 20))
        pause = np.zeros(int(RATE * seg.get("pause", 0.5)), dtype=np.float32)
        slide = slides.setdefault(str(seg.get("slide", 1)), {"start": cursor / RATE})
        entry = {"slide": seg.get("slide", 1), "start": cursor / RATE}
        cursor += len(audio)
        slide["spoken_end"] = entry["spoken_end"] = cursor / RATE
        cursor += len(pause)
        slide["end"] = entry["end"] = cursor / RATE
        timeline.append(entry)
        pieces += [audio, pause]

    voice = np.concatenate(pieces)
    peak = np.max(np.abs(voice))
    if peak > 0.98:
        voice = voice * (0.98 / peak)
    sf.write(args.out, voice, samplerate=RATE)
    with open(f"{args.out}.json", "w", encoding="utf-8") as f:
        json.dump({"seconds": len(voice) / RATE, "slides": slides, "segments": timeline, "device": device}, f, indent=2)
    print(f"voice: {args.out} ({len(voice) / RATE:.1f}s, {len(segments)} segments, {device}, {time.time() - started:.0f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
