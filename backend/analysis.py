"""Signal analysis for the visualizations: waveform, spectrum (FFT), spectrogram."""
import base64
import numpy as np
from effects import stft

FMAX = 8000  # show up to 8 kHz (voice range)


def analyze(y, sr):
    n = len(y)
    # waveform: min/max per segment (600 segments)
    segs = np.array_split(y, 600) if n >= 600 else [y]
    wave = [[round(float(s.min()), 3), round(float(s.max()), 3)] for s in segs if len(s)]

    # average magnitude spectrum (like Welch): mean |STFT|^2 over time, in dB
    n_fft = 2048
    kmax = min(int(FMAX * n_fft / sr), n_fft // 2)
    P = np.mean(np.abs(stft(y, n_fft, 1024)[:, :kmax]) ** 2, axis=0)
    db = 10 * np.log10(P + 1e-12)
    db = np.clip(db - db.max(), -90, 0)
    freqs = np.arange(kmax) * sr / n_fft

    # spectrogram: 20*log10 |STFT|, quantized to 0-255, sent as base64 bytes
    n_fft2 = 1024
    hop = max(256, n // 300)
    kmax2 = min(int(FMAX * n_fft2 / sr), n_fft2 // 2)
    S = 20 * np.log10(np.abs(stft(y, n_fft2, hop)[:, :kmax2]) + 1e-9)
    S = np.clip(S - S.max(), -80, 0)
    q = ((S + 80) / 80 * 255).astype(np.uint8)

    return {
        "sr": sr, "duration": round(n / sr, 2), "wave": wave,
        "spectrum": {"freqs": [round(float(f), 1) for f in freqs], "db": [round(float(d), 1) for d in db]},
        "spectrogram": {"frames": int(q.shape[0]), "bins": int(q.shape[1]),
                        "data": base64.b64encode(q.tobytes()).decode()},
    }
