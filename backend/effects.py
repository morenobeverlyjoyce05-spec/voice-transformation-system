"""Voice effects written from scratch with NumPy (no DSP library).

Pitch shifting = STFT -> phase vocoder (time-stretch) -> resampling.
Robot          = ring modulation (+ slight pitch drop).
"""
import numpy as np

# pitch shift in semitones (12 semitones = 1 octave); ratio r = 2^(semitones/12)
SEMITONES = {"chipmunk": 10, "female": 4, "male": -5}
ROBOT_FREQ = 55  # Hz, ring-modulator carrier frequency


# ---------------------------------------------------------------- STFT / ISTFT
def _window(n_fft):
    return np.hanning(n_fft + 1)[:-1]          # periodic Hann window


def stft(y, n_fft, hop):
    """Short-Time Fourier Transform -> complex array (frames, bins)."""
    win = _window(n_fft)
    y = np.pad(y, (n_fft // 2, n_fft // 2))    # zero-pad so first/last samples are covered
    frames = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::hop]
    parts = [np.fft.rfft(frames[i:i + 1000] * win, axis=1) for i in range(0, len(frames), 1000)]
    return np.concatenate(parts)


def istft(D, n_fft, hop, length):
    """Inverse STFT by windowed overlap-add."""
    win = _window(n_fft)
    frames = np.fft.irfft(D, n=n_fft, axis=1) * win
    out = np.zeros(n_fft + hop * (len(frames) - 1))
    norm = np.zeros_like(out)
    for i, f in enumerate(frames):
        out[i * hop:i * hop + n_fft] += f
        norm[i * hop:i * hop + n_fft] += win ** 2
    out /= np.where(norm > 1e-8, norm, 1.0)
    out = out[n_fft // 2:]
    if len(out) < length:
        out = np.pad(out, (0, length - len(out)))
    return out[:length]


# ---------------------------------------------------------------- phase vocoder
def phase_vocoder(D, rate, hop):
    """Time-stretch an STFT by 1/rate while keeping frequencies unchanged.

    Magnitudes are interpolated between frames; phases are advanced using each
    bin's *true* frequency (expected advance + measured deviation), so the
    sinusoids stay coherent from frame to frame.
    """
    bins = D.shape[1]
    n_fft = (bins - 1) * 2
    omega = 2 * np.pi * hop * np.arange(bins) / n_fft       # expected phase advance per hop
    steps = np.arange(0, D.shape[0], rate)                   # fractional frame positions
    D = np.vstack([D, np.zeros((1, bins), dtype=D.dtype)])
    phase = np.angle(D[0])
    out = np.empty((len(steps), bins), dtype=np.complex128)
    for k, t in enumerate(steps):
        i = int(t)
        frac = t - i
        mag = (1 - frac) * np.abs(D[i]) + frac * np.abs(D[i + 1])
        out[k] = mag * np.exp(1j * phase)
        dphi = np.angle(D[i + 1]) - np.angle(D[i]) - omega   # deviation from expected advance
        dphi -= 2 * np.pi * np.round(dphi / (2 * np.pi))     # wrap to [-pi, pi]
        phase += omega + dphi
    return out


def pitch_shift(y, sr, steps, fast=False):
    """Change pitch by `steps` semitones without changing duration.
    1) stretch time by r = 2^(steps/12)   (phase vocoder)
    2) resample by r so length returns to normal -> every frequency is multiplied by r
    """
    r = 2 ** (steps / 12)
    n_fft, hop = (1024, 256) if fast else (2048, 512)
    if len(y) < n_fft:
        return y
    D = stft(y, n_fft, hop)
    stretched = istft(phase_vocoder(D, 1 / r, hop), n_fft, hop, int(len(y) * r))
    pos = np.arange(len(y)) * r                              # read the stretched signal r times faster
    return np.interp(pos, np.arange(len(stretched)), stretched).astype(np.float32)


# ---------------------------------------------------------------- effects
def robot(y, sr, offset=0):
    """Ring modulation: y[n] * sin(2*pi*f*n/sr). Multiplying in time shifts the
    spectrum by +/- f (sidebands) -> metallic sound. `offset` keeps the carrier
    continuous between real-time chunks."""
    t = (np.arange(len(y)) + offset) / sr
    carrier = np.sin(2 * np.pi * ROBOT_FREQ * t)
    return pitch_shift(y, sr, -1.5, fast=True) * carrier * 1.5


def fade_edges(y, sr, ms=5):
    """Tiny fade in/out so real-time chunk boundaries do not click."""
    n = min(int(sr * ms / 1000), len(y) // 2)
    if n > 0:
        ramp = np.linspace(0, 1, n)
        y[:n] *= ramp
        y[-n:] *= ramp[::-1]
    return y


def apply_effect(y, sr, effect, offset=0, fast=False):
    y = y.astype(np.float32)
    if effect == "robot":
        out = robot(y, sr, offset)
    elif effect in SEMITONES:
        out = pitch_shift(y, sr, SEMITONES[effect], fast)
    else:
        raise ValueError(f"Unknown effect: {effect}")
    out = np.clip(out, -1.0, 1.0).astype(np.float32)
    return fade_edges(out, sr) if fast else out
