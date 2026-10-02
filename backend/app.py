"""Multi-Mode Voice Transformation - Flask backend.
Run:  python backend/app.py   then open http://127.0.0.1:5000
"""
import io
import os
import numpy as np
from flask import Flask, request, send_from_directory, jsonify, Response
from flask_cors import CORS
from scipy.io import wavfile

from effects import apply_effect
from analysis import analyze

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend")
app = Flask(__name__, static_folder=FRONTEND, static_url_path="")
CORS(app)  # lets the page work from VS Code Live Server (port 5500) too


@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/api/transform", methods=["POST"])
def transform():
    effect = request.args.get("effect", "robot")
    offset = int(request.args.get("offset", 0))
    fast = request.args.get("fast", "0") == "1"   # 1 = real-time chunks
    try:
        sr, data = wavfile.read(io.BytesIO(request.get_data()))
        if data.ndim > 1:
            data = data.mean(axis=1)
        y = data.astype(np.float32) / 32768.0
        out = apply_effect(y, sr, effect, offset, fast)
        buf = io.BytesIO()
        wavfile.write(buf, sr, (out * 32767).astype(np.int16))
        return Response(buf.getvalue(), mimetype="audio/wav")
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error="Could not process audio: " + str(e)), 500


@app.route("/api/analyze", methods=["POST"])
def analyze_route():
    try:
        sr, data = wavfile.read(io.BytesIO(request.get_data()))
        if data.ndim > 1:
            data = data.mean(axis=1)
        return jsonify(analyze(data.astype(np.float32) / 32768.0, sr))
    except Exception as e:
        return jsonify(error="Could not analyze audio: " + str(e)), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
