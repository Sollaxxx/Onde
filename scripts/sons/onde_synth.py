#!/usr/bin/env python3
"""Pack « Montage » d'Onde : bruitages de montage vidéo entièrement synthétisés.

Risers, whooshes, impacts, transitions, glitchs, TV et analogique, interface, cartoon.
Tout est généré par ce script (aucun enregistrement extérieur) : les sons sont placés
dans le domaine public (CC0), crédités « Onde ». Le résultat est reproductible :
chaque son a sa propre graine aléatoire.

Sortie : <sortie>/sons/*.wav (48 kHz, 16 bits, stéréo) + <sortie>/catalog.json

Usage : python3 scripts/sons/onde_synth.py --sortie DOSSIER [--seulement riser,whoosh]
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48000
TAU = 2 * np.pi


# ======================================================================
# Briques de base
# ======================================================================

def n_(d: float) -> int:
    return max(1, int(round(d * SR)))


def tl(d: float) -> np.ndarray:
    return np.arange(n_(d)) / SR


def white(n: int, rng) -> np.ndarray:
    return rng.standard_normal(n) * 0.3


def colored(n: int, rng, slope: float) -> np.ndarray:
    """Bruit coloré : slope=0 blanc, 1 rose, 2 brun."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    spec /= f ** (slope / 2)
    x = np.fft.irfft(spec, n)
    return x / (np.abs(x).max() + 1e-9) * 0.5


def osc(freq, kind: str = "sine", rng=None, phase: float = 0.0) -> np.ndarray:
    """Oscillateur à fréquence variable (tableau ou constante)."""
    f = np.asarray(freq, dtype=float)
    ph = phase + np.cumsum(f) / SR
    if kind == "sine":
        return np.sin(TAU * ph)
    frac = ph % 1.0
    if kind == "saw":
        return 2 * frac - 1
    if kind == "square":
        return np.where(frac < 0.5, 1.0, -1.0)
    if kind == "tri":
        return 4 * np.abs(frac - 0.5) - 1
    raise ValueError(kind)


def sweep(n: int, a: float, b: float, curve: str = "exp", power: float = 1.0) -> np.ndarray:
    x = np.linspace(0, 1, n) ** power
    if curve == "exp":
        return a * (b / a) ** x
    return a + (b - a) * x


def env(n: int, points: list[tuple[float, float]]) -> np.ndarray:
    """Enveloppe par points (position 0..1, valeur), interpolée linéairement."""
    xs, ys = zip(*points)
    return np.interp(np.linspace(0, 1, n), xs, ys)


def decay(n: int, tau: float, attack: float = 0.002) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    a = n_(attack)
    e[:a] *= np.linspace(0, 1, a)
    f = min(n_(0.015), n // 3)  # extinction finale : jamais de coupure nette
    if f > 1:
        e[-f:] *= np.linspace(1, 0, f)
    return e


def filt(x: np.ndarray, kind: str, f, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def filt_sweep(x: np.ndarray, kind: str, freqs: np.ndarray, q: float = 1.0, block: int = 128) -> np.ndarray:
    """Filtre dont la fréquence varie dans le temps (traitement par blocs, état conservé)."""
    out = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        f = float(np.clip(freqs[min(i, len(freqs) - 1)], 20, SR / 2 - 200))
        if kind == "bandpass":
            bw = f / q
            lo, hi = max(20, f - bw / 2), min(SR / 2 - 100, f + bw / 2)
            sos = signal.butter(2, [lo, hi], btype="bandpass", fs=SR, output="sos")
        else:
            sos = signal.butter(2, f, btype=kind, fs=SR, output="sos")
        if zi is None or zi.shape[0] != sos.shape[0]:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return out


def sat(x: np.ndarray, drive: float = 2.0) -> np.ndarray:
    return np.tanh(x * drive) / np.tanh(drive)


def crush(x: np.ndarray, bits: int = 6, down: int = 6) -> np.ndarray:
    y = np.repeat(x[::down], down)[: len(x)]
    q = 2 ** (bits - 1)
    return np.round(y * q) / q


def pad(x: np.ndarray, d: float) -> np.ndarray:
    return np.concatenate([x, np.zeros((n_(d),) + x.shape[1:])])


def mix(*parts) -> np.ndarray:
    """Additionne des signaux (mono ou stéréo) de longueurs différentes."""
    parts = [p if p.ndim == 2 else np.stack([p, p], 1) for p in parts]
    n = max(len(p) for p in parts)
    out = np.zeros((n, 2))
    for p in parts:
        out[: len(p)] += p
    return out


def at(x: np.ndarray, t: float) -> np.ndarray:
    """Décale un signal de t secondes."""
    z = np.zeros((n_(t),) + x.shape[1:]) if t > 0 else np.zeros((0,) + x.shape[1:])
    return np.concatenate([z, x])


def stereo(x: np.ndarray, width: float = 0.5, rng=None, delay_ms: float = 11.0) -> np.ndarray:
    """Élargit un son mono : légère différence de retard et de filtrage entre gauche et droite."""
    if x.ndim == 2:
        return x
    d = int(delay_ms * SR / 1000)
    r = np.concatenate([np.zeros(d), x[:-d]]) if d else x
    side = (x - r) * 0.5 * width
    return np.stack([x + side, x - side], 1)


def panned(x: np.ndarray, pan) -> np.ndarray:
    """Panoramique (−1 gauche … +1 droite), constant ou variable."""
    if x.ndim == 2:
        x = x.mean(1)
    p = np.broadcast_to(np.asarray(pan, dtype=float), x.shape)
    ang = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(ang), x * np.sin(ang)], 1) * np.sqrt(2)


_IR_CACHE: dict = {}


def reverb(x: np.ndarray, size: float = 1.8, mix_: float = 0.25, damp: float = 6000, seed: int = 7) -> np.ndarray:
    """Réverbération à convolution sur une réponse impulsionnelle synthétique (stéréo)."""
    key = (size, damp, seed)
    if key not in _IR_CACHE:
        rng = np.random.default_rng(seed)
        n = n_(size)
        t = np.arange(n) / SR
        ir = rng.standard_normal((n, 2)) * np.exp(-t / (size / 6.9))[:, None]
        ir = filt(ir, "lowpass", damp)
        ir[: n_(0.012)] = 0  # pré-délai
        ir /= np.sqrt((ir ** 2).sum(0, keepdims=True)) + 1e-9
        _IR_CACHE[key] = ir
    ir = _IR_CACHE[key]
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x.copy()
    f = min(n_(0.015), len(x) // 3)  # le son sec s'éteint en douceur avant la traîne
    if f > 1:
        x[-f:] *= np.linspace(1, 0, f)[:, None]
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    dry = np.concatenate([x, np.zeros((len(wet) - len(x), 2))])
    return dry * (1 - mix_ * 0.5) + wet * mix_ * 1.6


def reverse(x: np.ndarray) -> np.ndarray:
    return x[::-1].copy()


def finalize(x: np.ndarray, peak_db: float = -1.0, fade_in: float = 0.002, fade_out: float = 0.03, trim_db: float = -66) -> np.ndarray:
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x - x.mean(0, keepdims=True)
    x = filt(x, "highpass", 22, order=2)
    # coupe le silence final
    a = np.abs(x).max(1)
    thr = a.max() * 10 ** (trim_db / 20)
    idx = np.nonzero(a > thr)[0]
    if len(idx):
        x = x[: min(len(x), idx[-1] + n_(0.02))]
    fi, fo = min(n_(fade_in), len(x) // 4), min(n_(fade_out), len(x) // 3)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    return x / (np.abs(x).max() + 1e-9) * 10 ** (peak_db / 20)


# ======================================================================
# Recettes
# ======================================================================

def riser_noise(rng, dur=2.0, top=9000, end="cut"):
    n = n_(dur)
    x = colored(n, rng, 0.6)
    x = filt_sweep(x, "bandpass", sweep(n, 220, top, power=1.6), q=1.2)
    x2 = filt_sweep(colored(n, rng, 0.3), "highpass", sweep(n, 800, 7000, power=1.4))
    e = env(n, [(0, 0), (0.6, 0.25), (0.92, 0.85), (1, 1)])
    s = stereo((x * 1.0 + x2 * 0.35) * e, 0.9)
    if end == "tail":
        return reverb(s, 2.2, 0.45)
    return s


def riser_tonal(rng, dur=3.0, base=55.0, octaves=2.0, bright=6000):
    n = n_(dur)
    f = sweep(n, base, base * 2 ** octaves, power=1.4)
    tone = sum(osc(f * (1 + d), "saw") for d in (-0.012, -0.004, 0.0, 0.006, 0.014)) / 5
    tone += 0.4 * osc(f * 2, "saw")
    tone = filt_sweep(tone, "lowpass", sweep(n, 250, bright, power=1.5))
    noise = filt_sweep(colored(n, rng, 0.5), "bandpass", sweep(n, 400, 8000, power=1.5), q=1.5) * 0.6
    e = env(n, [(0, 0), (0.5, 0.3), (0.95, 1), (1, 1)])
    return reverb(stereo(sat((tone + noise) * e, 1.5), 1.0), 1.6, 0.3)


def riser_pulse(rng, dur=4.0, base=110.0):
    """Montée en tension : impulsions qui accélèrent, ton qui monte."""
    n = n_(dur)
    t = np.arange(n) / SR
    rate = sweep(n, 3, 28, power=1.3)
    ph = np.cumsum(rate) / SR
    gate = (np.sin(TAU * ph) > 0.2).astype(float)
    gate = filt(gate, "lowpass", 180)
    f = sweep(n, base, base * 4, power=1.5)
    tone = (osc(f, "square") * 0.4 + osc(f * 1.005, "saw") * 0.5)
    tone = filt_sweep(tone, "lowpass", sweep(n, 400, 7000, power=1.4))
    noise = filt(colored(n, rng, 0.2), "highpass", 3000) * 0.5
    e = env(n, [(0, 0.15), (0.85, 0.9), (1, 1)])
    return reverb(stereo(sat((tone + noise) * gate * e, 1.6), 1.0), 1.2, 0.25)


def downlifter(rng, dur=2.0, low=120):
    n = n_(dur)
    x = colored(n, rng, 0.6)
    x = filt_sweep(x, "bandpass", sweep(n, 8000, low, power=0.5), q=1.3)
    sub = osc(sweep(n, 160, 35, power=0.6), "sine") * decay(n, dur / 3) * 0.8
    e = env(n, [(0, 1), (0.15, 0.8), (1, 0)])
    return reverb(mix(stereo(x * e, 0.9), sub), 2.0, 0.35)


def reverse_cymbal(rng, dur=2.0):
    n = n_(dur)
    t = np.arange(n) / SR
    metal = sum(np.sin(TAU * f * t + rng.uniform(0, 6)) * rng.uniform(0.3, 1) for f in rng.uniform(3000, 11000, 18))
    x = filt(white(n, rng) * 2 + metal * 0.05, "highpass", 2500) * np.exp(-t / (dur / 4))
    return stereo(reverse(reverb(x, 1.0, 0.3)[:n]), 1.0)


def whoosh(rng, dur=0.6, lo=300, hi=3500, peak=0.55, airy=0.5, pan_from=-0.7, pan_to=0.7):
    n = n_(dur)
    k = int(n * peak)
    f = np.concatenate([sweep(k, lo, hi, power=0.8), sweep(n - k, hi, lo * 0.8, power=1.2)])
    x = filt_sweep(colored(n, rng, 0.5), "bandpass", f, q=1.3)
    air = filt_sweep(white(n, rng), "highpass", f * 2.2) * airy
    e = env(n, [(0, 0), (peak * 0.6, 0.35), (peak, 1), (min(0.98, peak + 0.25), 0.25), (1, 0)])
    return reverb(panned((x + air) * e, sweep(n, pan_from, pan_to, "lin")), 0.9, 0.18)


def swipe(rng, dur=0.18, f0=2500, f1=9000):
    n = n_(dur)
    x = filt_sweep(white(n, rng), "bandpass", sweep(n, f0, f1), q=1.0)
    e = env(n, [(0, 0), (0.25, 1), (1, 0)])
    return stereo(x * e, 0.8)


def thump(rng, f0=120, f1=45, dur=0.35, click=0.6, noise_lp=2500):
    n = n_(dur)
    body = osc(sweep(n, f0, f1, power=0.4), "sine") * decay(n, dur / 3, 0.001)
    nz = filt(white(n, rng), "lowpass", noise_lp) * decay(n, 0.03, 0.0005) * click
    return sat(body + nz, 1.8)


def boom(rng, f0=70, f1=28, dur=3.0, size=3.0):
    n = n_(dur)
    sub = osc(sweep(n, f0, f1, power=0.5), "sine") * decay(n, dur / 3, 0.002)
    knock = thump(rng, 160, 50, 0.4, 1.0, 3000)
    rumble = filt(colored(n, rng, 2.0), "lowpass", 300) * decay(n, dur / 2.5, 0.005) * 1.5
    return reverb(mix(sat(sub * 1.2, 1.5), knock, rumble), size, 0.35, damp=3500)


def hit_cinematic(rng, dur=2.5, metal=True):
    n = n_(dur)
    t = np.arange(n) / SR
    parts = [boom(rng, 80, 32, dur, 2.6) * 0.9, thump(rng, 220, 70, 0.3, 1.0, 4000) * 0.8]
    crack = filt(white(n, rng), "bandpass", [1200, 6000]) * decay(n, 0.05, 0.0005) * 0.7
    parts.append(crack)
    if metal:
        m = sum(np.sin(TAU * f * t) * decay(n, rng.uniform(0.3, 1.0)) * a for f, a in zip(rng.uniform(300, 2500, 7), rng.uniform(0.05, 0.15, 7)))
        parts.append(m)
    return reverb(mix(*parts), 2.8, 0.3, damp=5000)


def punch(rng, weight=1.0, tight=1.0):
    """Le « tchouf » : coup sec et gras pour souligner un cut ou un texte."""
    n = n_(0.45)
    body = thump(rng, 140 * weight, 48, 0.4 / tight, 0.8, 3500)
    snap = filt(white(n, rng), "bandpass", [900, 5000]) * decay(n, 0.018 / tight, 0.0003) * 0.9
    air = filt(white(n, rng), "highpass", 5000) * decay(n, 0.04, 0.001) * 0.25
    return reverb(stereo(sat(mix(body, snap, air)[:, 0], 2.2), 0.4), 0.6, 0.12)


def bass_drop(rng, dur=1.6, f0=110, f1=32):
    n = n_(dur)
    f = sweep(n, f0, f1, power=0.7)
    x = osc(f, "sine") + 0.3 * osc(f * 2, "sine") * decay(n, 0.3)
    e = env(n, [(0, 0), (0.01, 1), (0.7, 0.8), (1, 0)])
    return stereo(sat(x * e, 2.5), 0.2)


def tape_stop(rng, dur=1.4, start=False):
    """Bande qui ralentit jusqu'à l'arrêt (ou qui démarre)."""
    n = n_(dur)
    speed = np.linspace(1, 0, n) ** 1.6 if not start else np.linspace(0, 1, n) ** 0.7
    chord = [220, 277.2, 329.6, 440]
    x = sum(osc(np.full(n, f) * speed, "saw") for f in chord) / 4
    x += 0.6 * osc(np.full(n, 110) * speed, "square")
    x = filt(x, "lowpass", 3500)
    x *= np.clip(speed * 3, 0, 1)
    return stereo(sat(x, 1.5), 0.6)


def power(rng, up=True, dur=0.9):
    n = n_(dur)
    f = sweep(n, 60, 2400, power=1.3) if up else sweep(n, 2400, 40, power=0.5)
    x = osc(f, "saw") * 0.5 + osc(f * 1.5, "square") * 0.2
    x = filt_sweep(x, "lowpass", f * 4)
    e = env(n, [(0, 0), (0.05, 1), (0.9, 0.9), (1, 0)]) if up else env(n, [(0, 1), (0.8, 0.6), (1, 0)])
    return reverb(stereo(x * e, 0.5), 0.8, 0.2)


def suck_back(rng, dur=0.7):
    return reverse(whoosh(rng, dur, 250, 4500, 0.45, 0.6, 0.6, -0.6))


def stutter(rng, dur=0.8, slices=8):
    src = riser_tonal(rng, 1.0, 110, 1.0)
    sl = n_(0.05)
    out = []
    pos = n_(0.5)
    for i in range(slices):
        seg = src[pos:pos + sl] * np.linspace(1, 0.7, sl)[:, None]
        r = n_(0.002)  # micro-fondus : la répétition claque sans craquer
        seg[:r] *= np.linspace(0, 1, r)[:, None]
        seg[-r:] *= np.linspace(1, 0, r)[:, None]
        out.append(seg * (1 - i / slices * 0.5))
        if rng.random() < 0.3:
            pos = n_(rng.uniform(0.2, 0.9))
    x = np.concatenate(out)
    return x


def glitch(rng, dur=0.6):
    """Glitch numérique : tranches aléatoires de bruit, de sons carrés, de bits écrasés et de silences."""
    out = []
    total = 0
    while total < n_(dur):
        k = n_(rng.uniform(0.012, 0.07))
        kind = rng.integers(0, 5)
        if kind == 0:
            seg = white(k, rng) * 2
        elif kind == 1:
            seg = osc(np.full(k, rng.uniform(200, 3000)), "square") * 0.6
        elif kind == 2:
            seg = crush(osc(np.full(k, rng.uniform(80, 600)), "sine"), int(rng.integers(2, 5)), int(rng.integers(4, 20)))
        elif kind == 3:
            seg = np.zeros(k)
        else:
            f0 = rng.uniform(300, 4000)
            seg = osc(sweep(k, f0, f0 * rng.uniform(0.2, 3)), "saw") * 0.5
        if rng.random() < 0.35:  # répétition façon tampon bloqué
            seg = np.tile(seg[: max(8, k // 4)], 4)[:k]
        out.append(seg)
        total += k
    x = np.concatenate(out)[: n_(dur)]
    x = filt(x, "highpass", 120)
    return panned(x, rng.uniform(-0.6, 0.6, size=1)[0] * np.sin(np.linspace(0, 9, len(x))))


def data_bleeps(rng, dur=0.7):
    out = []
    while sum(len(o) for o in out) < n_(dur):
        k = n_(rng.uniform(0.02, 0.05))
        out.append(osc(np.full(k, rng.choice([880, 1320, 1760, 2093, 2637, 3520])), "square") * decay(k, 0.03))
        out.append(np.zeros(n_(rng.uniform(0.005, 0.02))))
    x = filt(np.concatenate(out)[: n_(dur)], "lowpass", 7000) * 0.6
    return reverb(stereo(x, 0.6), 0.5, 0.15)


def error_buzz(rng, beeps=2):
    out = []
    for i in range(beeps):
        k = n_(0.14)
        b = osc(np.full(k, 155), "square") * 0.5 + osc(np.full(k, 158), "saw") * 0.5
        b = filt(b, "lowpass", 2500) * env(k, [(0, 0), (0.05, 1), (0.85, 1), (1, 0)])
        out += [b, np.zeros(n_(0.06))]
    return stereo(np.concatenate(out), 0.3)


def tv_static(rng, dur=1.5, hum=True):
    n = n_(dur)
    x = filt(white(n, rng) * 2, "bandpass", [250, 9000])
    flutter = 0.7 + 0.3 * filt(rng.standard_normal(n), "lowpass", 12) * 8
    crackle = (rng.random(n) < 0.0015) * rng.uniform(-1, 1, n) * 3
    out = x * np.clip(flutter, 0.2, 1.3) + crackle
    if hum:
        t = np.arange(n) / SR
        out += 0.08 * (np.sin(TAU * 50 * t) + 0.5 * np.sin(TAU * 150 * t))
    return stereo(out, 0.7)


def tv_on(rng):
    n = n_(1.6)
    t = np.arange(n) / SR
    click = filt(white(n_(0.01), rng), "bandpass", [800, 6000]) * 2
    thoomp = thump(rng, 90, 40, 0.5, 0.2, 800) * 0.8
    whine = np.sin(TAU * 15625 * t) * env(n, [(0, 0), (0.08, 0.04), (1, 0.025)])
    st = tv_static(rng, 0.45, False)[:, 0] * env(n_(0.45), [(0, 0), (0.1, 1), (1, 0)]) * 0.7
    return mix(click, at(thoomp, 0.01), at(st, 0.05), whine)


def tv_off(rng):
    n = n_(0.9)
    zap = osc(sweep(n, 2000, 40, power=0.4), "sine") * env(n, [(0, 1), (0.6, 0.5), (1, 0)]) * 0.6
    st = tv_static(rng, 0.3, False)[:, 0] * env(n_(0.3), [(0, 1), (1, 0)]) * 0.6
    click = filt(white(n_(0.008), rng), "bandpass", [1000, 7000]) * 2
    return mix(click, st, zap)


def channel_switch(rng):
    click = filt(white(n_(0.008), rng), "bandpass", [700, 5000]) * 2
    st = tv_static(rng, 0.35, True)[:, 0] * env(n_(0.35), [(0, 0.2), (0.1, 1), (0.8, 0.8), (1, 0)])
    return mix(click, at(st, 0.01), at(click * 0.7, 0.37))


def radio_tuning(rng, dur=2.2):
    n = n_(dur)
    st = tv_static(rng, dur, False)[:, 0] * 0.6
    f = 600 + 500 * np.sin(np.linspace(0, 5, n)) + 300 * np.sin(np.linspace(0, 17, n))
    whistle = osc(f, "sine") * 0.25 * (0.5 + 0.5 * np.sin(np.linspace(0, 23, n)))
    voiceish = filt(colored(n, rng, 1.0), "bandpass", [300, 2500]) * (np.sin(np.linspace(0, 31, n)) > 0.6) * 0.8
    x = filt(st + whistle + voiceish, "bandpass", [200, 5000])
    return stereo(x * env(n, [(0, 0), (0.05, 1), (0.95, 1), (1, 0)]), 0.4)


def crt_whine(rng, dur=2.0):
    n = n_(dur)
    t = np.arange(n) / SR
    x = np.sin(TAU * 15625 * t) * 0.5 + 0.1 * np.sin(TAU * 50 * t)
    return stereo(x * env(n, [(0, 0), (0.1, 1), (0.9, 1), (1, 0)]), 0.1)


def vhs(rng, dur=2.0):
    n = n_(dur)
    t = np.arange(n) / SR
    wobble = 1 + 0.01 * np.sin(TAU * 0.8 * t) + 0.004 * np.sin(TAU * 6 * t)
    hiss = filt(white(n, rng), "highpass", 4000) * 0.4
    motor = filt(colored(n, rng, 1.5), "bandpass", [60, 400]) * 0.5
    hum = 0.15 * np.sin(TAU * 50 * np.cumsum(wobble) / SR)
    return stereo(hiss + motor + hum, 0.6)


def click(rng, f=3000, body=0.4, length=0.04):
    n = n_(length)
    tick = filt(white(n, rng), "bandpass", [f * 0.5, min(f * 2.5, 20000)]) * decay(n, 0.0025, 0.0002)
    tone = np.sin(TAU * f * 0.6 * np.arange(n) / SR) * decay(n, 0.006, 0.0002) * body
    return stereo(tick * 2 + tone, 0.2)


def pop(rng, f0=300, f1=1000, dur=0.12):
    n = n_(dur)
    x = osc(sweep(n, f0, f1, power=0.5), "sine") * decay(n, dur / 4, 0.001)
    x += filt(white(n, rng), "bandpass", [1500, 6000]) * decay(n, 0.004, 0.0002) * 0.6
    return reverb(stereo(x, 0.2), 0.4, 0.08)


def toggle(rng, on=True):
    a, b = (1400, 2100) if on else (2100, 1400)
    return mix(click(rng, a, 0.8, 0.05), at(click(rng, b, 0.8, 0.05), 0.07))


def bell(f, dur=1.2, ratio=3.5, index=2.0):
    n = n_(dur)
    t = np.arange(n) / SR
    mod = np.sin(TAU * f * ratio * t) * index * decay(n, dur / 4)
    return np.sin(TAU * f * t + mod) * decay(n, dur / 3, 0.002)


def notification(rng, notes=(1318.5, 1760.0), gap=0.11, ratio=3.5):
    parts = [at(bell(f, 1.0, ratio, 1.6) * 0.5, i * gap) for i, f in enumerate(notes)]
    return reverb(stereo(mix(*parts)[:, 0], 0.4), 1.0, 0.2)


def success(rng):
    return notification(rng, (1046.5, 1318.5, 1568.0, 2093.0), 0.07, 2.0)


def error(rng):
    return notification(rng, (622.3, 440.0), 0.16, 1.41)


def boing(rng, dur=0.9, f=180):
    n = n_(dur)
    t = np.arange(n) / SR
    vib = 1 + 0.35 * np.sin(TAU * 13 * t) * np.exp(-t / 0.35)
    x = osc(f * vib * sweep(n, 1.0, 1.25, "lin"), "sine") * decay(n, dur / 3)
    x += 0.3 * osc(f * 2 * vib, "tri") * decay(n, dur / 5)
    return reverb(stereo(x, 0.2), 0.5, 0.1)


def slide_whistle(rng, up=True, dur=0.8):
    n = n_(dur)
    t = np.arange(n) / SR
    f = sweep(n, 500, 2000, power=0.8) if up else sweep(n, 2000, 450, power=0.8)
    f = f * (1 + 0.012 * np.sin(TAU * 6 * t))
    x = osc(f, "sine") + filt(white(n, rng), "highpass", 3000) * 0.08
    return reverb(stereo(x * env(n, [(0, 0), (0.08, 1), (0.85, 0.9), (1, 0)]), 0.2), 0.6, 0.12)


def bonk(rng, f=520):
    n = n_(0.35)
    knock = osc(sweep(n, f, f * 0.55, power=0.3), "sine") * decay(n, 0.05, 0.0005)
    wood = filt(white(n, rng), "bandpass", [f * 1.5, f * 4]) * decay(n, 0.02, 0.0003)
    return reverb(stereo(knock + wood * 1.5, 0.2), 0.4, 0.1)


def sad_trombone(rng):
    notes = [(293.7, 0.32), (277.2, 0.32), (261.6, 0.32), (246.9, 1.1)]
    out = []
    for i, (f, d) in enumerate(notes):
        n = n_(d)
        t = np.arange(n) / SR
        ff = np.full(n, f) * (1 + (0.02 * np.sin(TAU * 5.5 * t) * (t > 0.3) if i == 3 else 0))
        x = osc(ff, "saw")
        x = filt_sweep(x, "bandpass", 700 + 500 * np.sin(np.linspace(0, np.pi, n)), q=1.5)
        out.append(x * env(n, [(0, 0), (0.08, 1), (0.85, 0.9), (1, 0)]))
    return reverb(stereo(np.concatenate(out) * 1.5, 0.3), 0.8, 0.15)


def sparkle(rng, dur=1.2, count=14):
    parts = []
    for i in range(count):
        f = rng.choice([1567.98, 2093.0, 2349.3, 2637.0, 3135.96, 3520.0, 4186.0])
        t0 = (i / count) ** 1.2 * dur * 0.7 + rng.uniform(0, 0.03)
        parts.append(at(panned(bell(f, 0.6, 4.0, 1.0) * rng.uniform(0.15, 0.35), rng.uniform(-0.8, 0.8)), t0))
    return reverb(mix(*parts), 1.6, 0.35)


def title_ding(rng, f=1760.0):
    x = mix(bell(f, 1.6, 2.0, 1.2) * 0.7, bell(f * 2, 1.0, 3.0, 0.8) * 0.2)
    return reverb(x, 1.4, 0.25)


def flash_charge(rng, dur=1.8):
    n = n_(dur)
    f = sweep(n, 1800, 9500, power=0.6)
    x = osc(f, "sine") * env(n, [(0, 0), (0.1, 0.6), (1, 0.4)])
    return stereo(x + filt(white(n, rng), "highpass", 6000) * 0.03, 0.1)


def flash_pop(rng):
    snap = filt(white(n_(0.08), rng), "bandpass", [1500, 9000]) * decay(n_(0.08), 0.012, 0.0003) * 2
    return reverb(mix(snap, thump(rng, 200, 90, 0.12, 0.2, 2000) * 0.3), 0.5, 0.15)


# ======================================================================
# Le pack : titre, catégorie, mots-clés, recette
# ======================================================================

CATS = {
    "RISR": ("Risers", "Risers"),
    "SWSH": ("Whooshes", "Whooshes"),
    "IMPT": ("Impacts", "Impacts"),
    "TRNS": ("Transitions", "Transitions"),
    "GLCH": ("Glitchs", "Glitches"),
    "ANLG": ("TV et analogique", "TV and analog"),
    "UI": ("Interface", "Interface"),
    "TOON": ("Cartoon", "Cartoon"),
    "CAM": ("Appareil photo", "Camera"),
}

T_RISER = ["riser", "montée", "montee", "build-up", "tension", "transition", "montage", "youtube"]
T_WHOOSH = ["whoosh", "swoosh", "passage", "transition", "montage", "youtube"]
T_IMPACT = ["impact", "hit", "coup", "boom", "montage", "youtube", "trailer", "bande-annonce"]

PACK = [
    # code, titre FR, titre EN, mots-clés, recette, paramètres
    ("RISR", "Riser souffle 1 s", "Noise riser 1 s", T_RISER + ["souffle", "noise"], riser_noise, dict(dur=1.0)),
    ("RISR", "Riser souffle 2 s", "Noise riser 2 s", T_RISER + ["souffle", "noise"], riser_noise, dict(dur=2.0)),
    ("RISR", "Riser souffle 4 s", "Noise riser 4 s", T_RISER + ["souffle", "noise"], riser_noise, dict(dur=4.0)),
    ("RISR", "Riser souffle 8 s", "Noise riser 8 s", T_RISER + ["souffle", "noise", "long"], riser_noise, dict(dur=8.0)),
    ("RISR", "Riser souffle avec traîne", "Noise riser with tail", T_RISER + ["souffle", "réverbération"], riser_noise, dict(dur=3.0, end="tail")),
    ("RISR", "Riser tonal grave 3 s", "Dark tonal riser 3 s", T_RISER + ["tonal", "grave", "dark"], riser_tonal, dict(dur=3.0, base=41.2, bright=3500)),
    ("RISR", "Riser tonal 3 s", "Tonal riser 3 s", T_RISER + ["tonal"], riser_tonal, dict(dur=3.0)),
    ("RISR", "Riser tonal brillant 5 s", "Bright tonal riser 5 s", T_RISER + ["tonal", "brillant", "bright"], riser_tonal, dict(dur=5.0, base=82.4, octaves=2.5, bright=9000)),
    ("RISR", "Montée en tension 4 s", "Pulsing build-up 4 s", T_RISER + ["impulsions", "pulse", "accélère"], riser_pulse, dict(dur=4.0)),
    ("RISR", "Montée en tension 2 s", "Pulsing build-up 2 s", T_RISER + ["impulsions", "pulse"], riser_pulse, dict(dur=2.0, base=146.8)),
    ("RISR", "Descente (downlifter) 2 s", "Downlifter 2 s", ["downlifter", "descente", "drop", "transition", "montage"], downlifter, dict(dur=2.0)),
    ("RISR", "Descente (downlifter) 4 s", "Downlifter 4 s", ["downlifter", "descente", "drop", "transition", "montage"], downlifter, dict(dur=4.0, low=80)),
    ("RISR", "Cymbale inversée 2 s", "Reverse cymbal 2 s", ["cymbale", "inversée", "reverse", "cymbal", "riser", "transition"], reverse_cymbal, dict(dur=2.0)),
    ("RISR", "Cymbale inversée 4 s", "Reverse cymbal 4 s", ["cymbale", "inversée", "reverse", "cymbal", "riser", "transition"], reverse_cymbal, dict(dur=4.0)),

    ("SWSH", "Whoosh rapide #1", "Fast whoosh #1", T_WHOOSH + ["rapide", "fast"], whoosh, dict(dur=0.35)),
    ("SWSH", "Whoosh rapide #2", "Fast whoosh #2", T_WHOOSH + ["rapide", "fast"], whoosh, dict(dur=0.4, lo=500, hi=5000, pan_from=0.7, pan_to=-0.7)),
    ("SWSH", "Whoosh rapide #3", "Fast whoosh #3", T_WHOOSH + ["rapide", "fast"], whoosh, dict(dur=0.3, lo=700, hi=6000, airy=0.8)),
    ("SWSH", "Whoosh moyen #1", "Medium whoosh #1", T_WHOOSH, whoosh, dict(dur=0.7)),
    ("SWSH", "Whoosh moyen #2", "Medium whoosh #2", T_WHOOSH, whoosh, dict(dur=0.8, lo=200, hi=2500, pan_from=0.6, pan_to=-0.6)),
    ("SWSH", "Whoosh lent", "Slow whoosh", T_WHOOSH + ["lent", "slow"], whoosh, dict(dur=1.4, lo=150, hi=2200, peak=0.6)),
    ("SWSH", "Whoosh grave", "Low whoosh", T_WHOOSH + ["grave", "low", "dark"], whoosh, dict(dur=0.9, lo=80, hi=900, airy=0.15)),
    ("SWSH", "Whoosh aérien", "Airy whoosh", T_WHOOSH + ["aérien", "airy", "léger"], whoosh, dict(dur=0.8, lo=1500, hi=9000, airy=1.2)),
    ("SWSH", "Swipe #1", "Swipe #1", T_WHOOSH + ["swipe", "glissement", "écran"], swipe, dict()),
    ("SWSH", "Swipe #2", "Swipe #2", T_WHOOSH + ["swipe", "glissement", "écran"], swipe, dict(dur=0.14, f0=4000, f1=12000)),
    ("SWSH", "Swipe grave", "Low swipe", T_WHOOSH + ["swipe", "grave"], swipe, dict(dur=0.22, f0=600, f1=3000)),

    ("IMPT", "Tchouf #1", "Punch hit #1", T_IMPACT + ["tchouf", "punch", "sec", "texte"], punch, dict()),
    ("IMPT", "Tchouf #2", "Punch hit #2", T_IMPACT + ["tchouf", "punch", "sec", "texte"], punch, dict(weight=1.3, tight=1.3)),
    ("IMPT", "Tchouf #3", "Punch hit #3", T_IMPACT + ["tchouf", "punch", "grave"], punch, dict(weight=0.8, tight=0.8)),
    ("IMPT", "Tchouf aigu", "Bright punch hit", T_IMPACT + ["tchouf", "punch", "aigu"], punch, dict(weight=1.8, tight=1.6)),
    ("IMPT", "Boom grave #1", "Sub boom #1", T_IMPACT + ["sub", "grave", "basse"], boom, dict()),
    ("IMPT", "Boom grave #2", "Sub boom #2", T_IMPACT + ["sub", "grave", "basse"], boom, dict(f0=55, f1=24, dur=4.0, size=4.0)),
    ("IMPT", "Boom court", "Short boom", T_IMPACT + ["sub", "court"], boom, dict(f0=90, f1=40, dur=1.2, size=1.2)),
    ("IMPT", "Impact cinéma #1", "Cinematic hit #1", T_IMPACT + ["cinéma", "cinematic", "métal"], hit_cinematic, dict()),
    ("IMPT", "Impact cinéma #2", "Cinematic hit #2", T_IMPACT + ["cinéma", "cinematic", "métal"], hit_cinematic, dict(dur=3.5)),
    ("IMPT", "Impact cinéma sans métal", "Cinematic hit, no metal", T_IMPACT + ["cinéma", "cinematic"], hit_cinematic, dict(metal=False)),
    ("IMPT", "Bass drop", "Bass drop", T_IMPACT + ["bass", "drop", "808", "basse"], bass_drop, dict()),
    ("IMPT", "Bass drop long", "Long bass drop", T_IMPACT + ["bass", "drop", "808", "basse"], bass_drop, dict(dur=3.0, f0=130, f1=28)),
    ("IMPT", "Coup sourd", "Thud", T_IMPACT + ["sourd", "thud"], thump, dict(f0=110, f1=40, dur=0.5)),

    ("TRNS", "Arrêt de bande (tape stop)", "Tape stop", ["tape", "stop", "bande", "ralenti", "arrêt", "transition", "montage"], tape_stop, dict()),
    ("TRNS", "Arrêt de bande rapide", "Fast tape stop", ["tape", "stop", "bande", "ralenti", "transition"], tape_stop, dict(dur=0.7)),
    ("TRNS", "Démarrage de bande", "Tape start", ["tape", "start", "bande", "démarrage", "transition"], tape_stop, dict(dur=1.0, start=True)),
    ("TRNS", "Aspiration (suck back)", "Suck back", ["aspiration", "suck", "reverse", "inversé", "transition", "whoosh"], suck_back, dict()),
    ("TRNS", "Aspiration courte", "Short suck back", ["aspiration", "suck", "reverse", "transition"], suck_back, dict(dur=0.4)),
    ("TRNS", "Mise sous tension", "Power up", ["power", "up", "allumage", "charge", "transition"], power, dict(up=True)),
    ("TRNS", "Mise hors tension", "Power down", ["power", "down", "extinction", "transition"], power, dict(up=False)),
    ("TRNS", "Bégaiement (stutter)", "Stutter", ["stutter", "bégaiement", "répétition", "transition", "glitch"], stutter, dict()),
    ("TRNS", "Bégaiement long", "Long stutter", ["stutter", "bégaiement", "répétition", "transition"], stutter, dict(slices=14)),

    *[("GLCH", f"Glitch numérique #{i + 1}", f"Digital glitch #{i + 1}", ["glitch", "numérique", "digital", "bug", "transition", "montage"], glitch, dict(dur=d))
      for i, d in enumerate([0.25, 0.35, 0.5, 0.6, 0.8, 1.0, 0.4, 1.4])],
    ("GLCH", "Bips de données #1", "Data bleeps #1", ["données", "data", "bips", "ordinateur", "glitch"], data_bleeps, dict()),
    ("GLCH", "Bips de données #2", "Data bleeps #2", ["données", "data", "bips", "ordinateur", "glitch"], data_bleeps, dict(dur=1.2)),
    ("GLCH", "Erreur (buzz)", "Error buzz", ["erreur", "error", "buzz", "faux", "wrong"], error_buzz, dict()),
    ("GLCH", "Erreur (buzz) long", "Long error buzz", ["erreur", "error", "buzz", "faux", "wrong"], error_buzz, dict(beeps=3)),

    ("ANLG", "Neige TV", "TV static", ["tv", "télé", "neige", "static", "parasites", "vintage"], tv_static, dict(dur=2.0)),
    ("ANLG", "Neige TV courte", "Short TV static", ["tv", "télé", "neige", "static", "parasites"], tv_static, dict(dur=0.6)),
    ("ANLG", "Allumage TV cathodique", "CRT TV turn on", ["tv", "télé", "cathodique", "crt", "allumage", "vintage"], tv_on, dict()),
    ("ANLG", "Extinction TV cathodique", "CRT TV turn off", ["tv", "télé", "cathodique", "crt", "extinction", "vintage"], tv_off, dict()),
    ("ANLG", "Changement de chaîne", "Channel switch", ["tv", "télé", "chaîne", "zapping", "channel"], channel_switch, dict()),
    ("ANLG", "Recherche de station radio", "Radio tuning", ["radio", "station", "recherche", "tuning", "parasites"], radio_tuning, dict()),
    ("ANLG", "Sifflement cathodique", "CRT whine", ["crt", "cathodique", "sifflement", "whine", "aigu"], crt_whine, dict()),
    ("ANLG", "Magnétoscope VHS", "VHS player", ["vhs", "magnétoscope", "cassette", "vintage", "souffle"], vhs, dict()),

    *[("UI", f"Clic #{i + 1}", f"Click #{i + 1}", ["clic", "click", "interface", "ui", "bouton"], click, dict(f=f, body=b))
      for i, (f, b) in enumerate([(3000, 0.4), (2200, 0.7), (4500, 0.2), (1600, 0.9), (6000, 0.1), (2600, 0.5)])],
    *[("UI", f"Pop #{i + 1}", f"Pop #{i + 1}", ["pop", "bulle", "bubble", "apparition", "interface", "texte"], pop, dict(f0=a, f1=b))
      for i, (a, b) in enumerate([(300, 1000), (450, 1400), (250, 700), (600, 1900)])],
    ("UI", "Bloop (descendant)", "Bloop (down)", ["bloop", "pop", "disparition", "interface"], pop, dict(f0=1200, f1=300, dur=0.16)),
    ("UI", "Interrupteur activé", "Toggle on", ["interrupteur", "toggle", "activé", "on", "interface"], toggle, dict(on=True)),
    ("UI", "Interrupteur désactivé", "Toggle off", ["interrupteur", "toggle", "désactivé", "off", "interface"], toggle, dict(on=False)),
    ("UI", "Notification #1", "Notification #1", ["notification", "message", "alerte", "ding", "interface"], notification, dict()),
    ("UI", "Notification #2", "Notification #2", ["notification", "message", "alerte", "interface"], notification, dict(notes=(1567.98, 2093.0), ratio=2.0)),
    ("UI", "Notification #3", "Notification #3", ["notification", "message", "alerte", "interface"], notification, dict(notes=(1046.5, 1568.0, 1318.5), gap=0.09)),
    ("UI", "Réussite", "Success", ["réussite", "succès", "success", "validé", "bonne réponse", "interface"], success, dict()),
    ("UI", "Erreur", "Error", ["erreur", "error", "échec", "mauvaise réponse", "interface"], error, dict()),

    ("TOON", "Boing #1", "Boing #1", ["boing", "ressort", "spring", "cartoon", "drôle"], boing, dict()),
    ("TOON", "Boing #2", "Boing #2", ["boing", "ressort", "spring", "cartoon", "drôle"], boing, dict(f=260, dur=0.7)),
    ("TOON", "Sifflet à coulisse montant", "Slide whistle up", ["sifflet", "coulisse", "slide", "whistle", "cartoon", "montant"], slide_whistle, dict(up=True)),
    ("TOON", "Sifflet à coulisse descendant", "Slide whistle down", ["sifflet", "coulisse", "slide", "whistle", "cartoon", "chute"], slide_whistle, dict(up=False)),
    ("TOON", "Bonk", "Bonk", ["bonk", "coup", "tête", "cartoon", "drôle"], bonk, dict()),
    ("TOON", "Bonk aigu", "High bonk", ["bonk", "coup", "cartoon"], bonk, dict(f=880)),
    ("TOON", "Trombone triste", "Sad trombone", ["trombone", "triste", "échec", "fail", "cartoon", "drôle"], sad_trombone, dict()),
    ("TOON", "Scintillement", "Sparkle", ["scintillement", "sparkle", "magie", "magic", "brillant", "étoiles"], sparkle, dict()),
    ("TOON", "Scintillement court", "Short sparkle", ["scintillement", "sparkle", "magie", "magic"], sparkle, dict(dur=0.6, count=8)),
    ("TOON", "Ding de titre", "Title ding", ["ding", "titre", "texte", "cloche", "apparition"], title_ding, dict()),
    ("TOON", "Ding de titre aigu", "High title ding", ["ding", "titre", "texte", "cloche"], title_ding, dict(f=2637.0)),

    ("CAM", "Flash qui se charge", "Camera flash charging", ["flash", "charge", "appareil photo", "camera", "photo"], flash_charge, dict()),
    ("CAM", "Flash", "Camera flash", ["flash", "appareil photo", "camera", "photo"], flash_pop, dict()),
]

PEAK_DB = {"UI": -3.0, "CAM": -2.0}
# Sons très aigus ou très chargés en graves : niveau abaissé pour ne pas agresser l'oreille.
PEAK_TITLE = {"Sifflement cathodique": -24.0, "Flash qui se charge": -14.0, "Bass drop": -3.0, "Bass drop long": -3.0}


# ======================================================================
# Écriture
# ======================================================================

def slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s.replace("œ", "oe")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def peaks(x: np.ndarray, count: int = 120) -> list[float]:
    a = np.abs(x).max(1)
    chunks = np.array_split(a, count)
    p = np.array([c.max() if len(c) else 0 for c in chunks])
    p /= p.max() + 1e-9
    return [round(float(v), 3) for v in p]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True, type=Path)
    ap.add_argument("--seulement", default="", help="codes de catégories, séparés par des virgules")
    args = ap.parse_args()
    only = {c.strip().upper() for c in args.seulement.split(",") if c.strip()}
    (args.sortie / "sons").mkdir(parents=True, exist_ok=True)
    catalog = []
    for i, (code, title, title_en, tags, fn, params) in enumerate(PACK, start=1):
        if only and code not in only:
            continue
        rng = np.random.default_rng(1000 + i)
        x = finalize(fn(rng, **params), PEAK_TITLE.get(title, PEAK_DB.get(code, -1.0)))
        sid = f"onde-{i:04d}"
        file = f"{code}_{slug(title)}_O{i:03d}.wav"
        write_wav(args.sortie / "sons" / file, x)
        cat, cat_en = CATS[code]
        catalog.append({
            "id": sid,
            "title": title,
            "titleEn": title_en,
            "code": code,
            "category": cat,
            "tags": sorted(set(tags)),
            "durationMs": int(round(len(x) / SR * 1000)),
            "file": file,
            "format": "WAV · 48 kHz · 16 bits · stéréo",
            "license": "CC0",
            "author": "Onde",
            "credit": "Onde (sons de synthèse)",
            "source": "Onde",
            "peaks": peaks(x),
        })
        print(f"{sid}  {len(x) / SR:5.2f} s  {file}", flush=True)
    (args.sortie / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(catalog)} sons écrits dans {args.sortie}")


if __name__ == "__main__":
    main()
