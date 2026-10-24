"""Recites a poem in the page owner's voice with AI4Bharat IndicF5 (MIT), cloned from a short reference clip.

Usage:
  python scripts/voice/speak.py --lines lines.json --ref-audio reference.wav --ref-text "…" --out voice.wav

lines.json is a JSON list of Devanagari lines; "" marks a stanza break. Each line is spoken on its own
(more steps and a slightly slower pace than the defaults, for a smooth, clear delivery) and the lines are
joined with short breathing pauses, longer between stanzas. The reference clip (≤ 15 s) and its exact
transcript decide the voice. Needs HF_TOKEN (the model is gated: accept its terms on huggingface.co once).
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
    """Cuts leading/trailing near-silence so the pauses between lines are exactly the ones we add."""
    loud = np.where(np.abs(audio) > threshold)[0]
    return audio[max(0, loud[0] - 1200): loud[-1] + 2400] if len(loud) else audio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lines", required=True, help="JSON file: list of Devanagari lines, \"\" = stanza break")
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--ref-text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--speed", type=float, default=0.9)
    parser.add_argument("--nfe", type=int, default=64)
    parser.add_argument("--pause", type=float, default=0.45, help="seconds between lines")
    parser.add_argument("--stanza-pause", type=float, default=0.9, help="seconds between stanzas")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    with open(args.lines, encoding="utf-8") as f:
        lines = json.load(f)
    started = time.time()
    torch.manual_seed(args.seed)
    model = load_model()
    device = model.device
    model.ema_model.to(device)
    model.vocoder.to(device)
    ref_audio, ref_text = preprocess_ref_audio_text(args.ref_audio, args.ref_text, show_info=lambda *a: None)

    pieces = []
    gap = 0.0
    for line in lines:
        if not line.strip():
            gap = args.stanza_pause
            continue
        if pieces:
            pieces.append(np.zeros(int(RATE * (gap or args.pause)), dtype=np.float32))
        gap = 0.0
        audio, _, _ = infer_process(
            ref_audio, ref_text, line.strip(), model.ema_model, model.vocoder,
            mel_spec_type="vocos", nfe_step=args.nfe, speed=args.speed, device=device, show_info=lambda *a: None,
        )
        pieces.append(trim(np.asarray(audio, dtype=np.float32)))

    voice = np.concatenate(pieces)
    sf.write(args.out, voice, samplerate=RATE)
    spoken = sum(1 for line in lines if line.strip())
    print(f"voice: {args.out} ({len(voice) / RATE:.1f}s audio, {spoken} lines, {time.time() - started:.0f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
