# Multi-Mode Voice Transformation

## Folder structure
```
voice-transformation/
├── backend/
│   ├── app.py          Flask server + API
│   ├── effects.py      Voice effects (own STFT + phase vocoder, NumPy)
│   └── analysis.py     Waveform / FFT / spectrogram data
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── requirements.txt
```

## Run
```
pip install -r requirements.txt
python backend/app.py
```
Open http://127.0.0.1:5000 in your browser (allow the microphone).

Optional: you can also open frontend/index.html with VS Code Live Server (port 5500);
it will talk to the Python server on port 5000, so keep `python backend/app.py` running.
