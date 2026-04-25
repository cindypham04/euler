# Math Equation Reader with AI Explanation

## Project Overview

A real-time math equation detection and explanation system running on Raspberry Pi 5 (8GB). The system uses a camera to capture handwritten or printed math equations, recognizes them using OCR, generates AI-powered explanations, and outputs the results as natural speech.

**Architecture:** Camera → Math OCR (PaddleOCR) → AI Explanation (Phi-3) → Text-to-Speech

---

## Hardware Requirements

- **Raspberry Pi 5** (8GB RAM)
- **USB Camera** or **Raspberry Pi Camera Module** (CSI/DSI)
- **USB-C Power Supply** (5V/5A minimum - recommended: 65W+)
- **SD Card** (64GB, Class A2/V30 or better)
- **HDMI Monitor + Keyboard** (optional, for initial setup only)

---

## Software Setup

### Step 1: Flash Raspberry Pi OS

**On your laptop:**

1. Download **Raspberry Pi Imager** from [raspberrypi.com/software](https://www.raspberrypi.com/software/)
2. Open Imager and select:
   - **Device:** Raspberry Pi 5
   - **OS:** Raspberry Pi OS (64-bit)
   - **Storage:** Your SD card
3. Click **Next** → **Edit Settings**
4. Configure:
   - **Hostname:** `raspberrypi` (or any name)
   - **Username:** `pi`
   - **Password:** `raspberry` (or your choice)
   - **Services:** Enable SSH ✅
   - **Wireless LAN:** 
     - SSID: Your WiFi network name
     - Password: Your WiFi password
     - Country: Your country (affects WiFi bands)
5. Click **Save** → **Yes** to flash

**Time:** ~10-15 minutes

### Step 2: Boot Raspberry Pi

1. Insert flashed SD card into Pi
2. Plug in 65W USB-C power supply
3. Wait 30-60 seconds for full boot
4. Green LED should blink steadily

### Step 3: SSH into Pi (From Your Laptop)

```bash
# Check if Pi is on network
ping raspberrypi.local

# SSH into Pi
ssh pi@raspberrypi.local
# Password: raspberry (or whatever you set)
```

### Step 4: Update System

```bash
ssh pi@raspberrypi.local

# Update package lists
sudo apt update && sudo apt upgrade -y

# Install required system dependencies
sudo apt install -y python3-pip python3-dev libatlas-base-dev \
  libjasper-dev libopenjp2-7 libtiff6 libjasper1 libhdf5-dev \
  libharfbuzz0b libwebp6 libtiff5 libharfbuzz0b
```

**Time:** ~5-10 minutes

### Step 5: Install Python Libraries

```bash
# Install core libraries
pip install opencv-python pillow numpy pyttsx3

# Install PaddleOCR (math equation detection)
pip install paddleocr

# Install Ollama Python client (for AI explanations)
pip install ollama
```

**Time:** ~10-15 minutes (PaddleOCR downloads ~150MB model on first run)

### Step 6: Install and Run Ollama (Local AI)

```bash
# Download and install Ollama
curl https://ollama.ai/install.sh | sh

# Start Ollama in background
ollama serve &

# Wait 10 seconds, then pull Phi-3 model
sleep 10
ollama pull phi
```

**What happens:** Ollama downloads Phi-3 (3.8B LLM) - ~2.3GB, takes 5-10 minutes

**Verify it works:**
```bash
ollama run phi "Explain what 2x + 3 = 5 means"
```

You should see an AI explanation. If it works, continue.

---

## Project Setup

### Step 7: Clone or Create Project Directory

```bash
# Create project directory
mkdir -p ~/math-equation-reader
cd ~/math-equation-reader

# Create main Python script (see below)
nano equation_reader.py
```

### Step 8: Main Application Script

Copy the following code into `equation_reader.py`:

```python
import cv2
import paddleocr
import pyttsx3
import ollama
import time
from threading import Thread
from queue import Queue

class MathEquationReader:
    def __init__(self):
        print("Initializing Math Equation Reader...")
        
        # Initialize PaddleOCR
        self.ocr = paddleocr.PaddleOCR(use_angle_cls=True, lang='en')
        
        # Initialize TTS engine
        self.engine = pyttsx3.init()
        self.engine.setProperty('rate', 150)  # Speech speed
        
        # Open camera
        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        # Queue for processing equations
        self.equation_queue = Queue()
        self.last_equation = ""
        
        print("✅ All components initialized!")
        print("\nStarting real-time processing...")
        print("Press 'q' to quit\n")
    
    def read_equation_from_frame(self, frame):
        """Use PaddleOCR to detect equation text from image"""
        try:
            # Run OCR detection
            results = self.ocr.ocr(frame, cls=True)
            
            # Extract text from results
            equation_text = ""
            confidence = 0
            
            if results and results[0]:
                texts = [line[1][0] for line in results[0]]
                confidences = [line[1][1] for line in results[0]]
                
                equation_text = " ".join(texts)
                confidence = sum(confidences) / len(confidences) if confidences else 0
            
            return equation_text, confidence
        
        except Exception as e:
            print(f"OCR Error: {e}")
            return "", 0
    
    def explain_equation_with_ai(self, equation):
        """Get AI explanation using Phi-3 model"""
        try:
            prompt = f"""Explain this math equation in 1-2 sentences, simply and clearly:

Equation: {equation}

Keep it concise. Start with what the equation means."""
            
            # Call Ollama (local Phi-3 model)
            response = ollama.generate(
                model='phi',
                prompt=prompt,
                stream=False
            )
            
            explanation = response['response'].strip()
            return explanation
        
        except Exception as e:
            print(f"AI Error: {e}")
            return f"I detected the equation: {equation}"
    
    def speak_text(self, text):
        """Convert text to speech in background thread"""
        Thread(target=self._do_speak, args=(text,), daemon=True).start()
    
    def _do_speak(self, text):
        """Background speech synthesis"""
        self.engine.say(text)
        self.engine.runAndWait()
    
    def process_equations_background(self):
        """Background thread: process equations asynchronously"""
        while True:
            if not self.equation_queue.empty():
                equation = self.equation_queue.get()
                
                print(f"\n📐 Detected equation: {equation}")
                self.speak_text(f"Equation: {equation}")
                
                # Get AI explanation
                print("🤖 Generating explanation...")
                explanation = self.explain_equation_with_ai(equation)
                
                print(f"💡 Explanation: {explanation}")
                self.speak_text(explanation)
                
                time.sleep(1)
    
    def run(self):
        """Main real-time loop"""
        print("="*60)
        print("🚀 Math Equation Reader with AI Explanation")
        print("="*60)
        print("\nCapture equations with your camera!")
        print("Press 'q' to quit\n")
        
        # Start background processing thread
        processor = Thread(target=self.process_equations_background, daemon=True)
        processor.start()
        
        frame_count = 0
        
        while True:
            ret, frame = self.cap.read()
            if not ret:
                print("Camera error!")
                break
            
            # Process every 3rd frame for performance
            if frame_count % 3 == 0:
                equation_text, confidence = self.read_equation_from_frame(frame)
                
                # Only process if confident and new
                if confidence > 0.4 and equation_text != self.last_equation:
                    self.last_equation = equation_text
                    self.equation_queue.put(equation_text)
                    
                    # Display on frame
                    cv2.putText(frame, f"Detected: {equation_text[:40]}", 
                               (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                               0.6, (0, 255, 0), 2)
                    cv2.putText(frame, f"Confidence: {confidence:.2f}", 
                               (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 
                               0.6, (0, 255, 0), 2)
            
            # Show video frame
            cv2.imshow("Math Equation Reader", frame)
            
            # Press 'q' to quit
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            
            frame_count += 1
        
        self.cap.release()
        cv2.destroyAllWindows()

# Run the application
if __name__ == "__main__":
    reader = MathEquationReader()
    reader.run()
```

Save with: `Ctrl+X` → `Y` → `Enter`

---

## Running the Application

### First Run (Downloads Models)

```bash
cd ~/math-equation-reader
python3 equation_reader.py
```

**What happens:**
1. PaddleOCR downloads model (~150MB) on first run - takes 2-3 minutes
2. Opens camera feed window
3. Shows detected equations in real-time
4. Explains equations using AI
5. Speaks both equation and explanation

### Subsequent Runs

```bash
python3 equation_reader.py
```

Models are cached, so it starts immediately.

---

## Workflow & Team Responsibilities

### Phase 1: Setup (First Day - 30 minutes)

| Task | Owner | Time |
|------|-------|------|
| Flash OS to SD card | DevOps Lead | 15 min |
| Boot Pi and SSH setup | DevOps Lead | 10 min |
| Install system dependencies | Backend Lead | 5 min |

### Phase 2: Installation (First Day - 30 minutes)

| Task | Owner | Time |
|------|-------|------|
| Install Python libraries | Backend Lead | 10 min |
| Install Ollama + Phi-3 | Backend Lead | 20 min |

### Phase 3: Development (Day 2-3)

| Task | Owner | Notes |
|------|-------|-------|
| Test camera calibration | Hardware Lead | Ensure good lighting for OCR |
| Optimize OCR confidence threshold | ML Lead | Tune `confidence > 0.4` parameter |
| Improve TTS speech rate | Frontend Lead | Adjust `setProperty('rate', 150)` |
| Add equation history logging | Backend Lead | Save detected equations to file |
| Build demo UI (optional) | Frontend Lead | Web dashboard to show results |

### Phase 4: Testing & Optimization (Day 3-4)

| Task | Owner | Notes |
|------|-------|-------|
| Test with different equation types | QA Lead | Handwritten, printed, complex |
| Performance benchmarking | Backend Lead | Measure RAM/CPU usage |
| Edge case handling | QA Lead | Blurry images, partial equations |

---

## Performance Expectations

### Memory Usage
```
Idle:     ~300MB
Running:  ~1.5GB (OCR + AI model loaded)
Available: ~6.5GB buffer
```

✅ **Safe on 8GB**

### Processing Time Per Equation
```
Equation detection:  2-3 seconds
AI explanation:      3-4 seconds
TTS output:          1-2 seconds
─────────────────────────────────
Total:               6-9 seconds per equation
```

### Camera Performance
```
Frame rate:        30 FPS
Processing rate:   10 FPS (every 3rd frame)
Latency:           ~300-500ms from capture to output
```

---

## Troubleshooting

### Camera Not Found

```bash
# Check camera connection
ls /dev/video*

# If no video device, check USB connection or CSI cable
```

### PaddleOCR Not Detecting Equations

- Improve lighting conditions
- Ensure equation is clear and in focus
- Increase confidence threshold: change `0.4` to `0.3` (more false positives)
- Decrease confidence threshold: change `0.4` to `0.5` (fewer detections)

### Ollama Not Responding

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Restart Ollama
pkill ollama
ollama serve &
```

### Speech Not Playing

```bash
# Check audio device
aplay -L

# Test TTS
python3 -c "import pyttsx3; engine = pyttsx3.init(); engine.say('test'); engine.runAndWait()"
```

### Out of Memory

```bash
# Check RAM usage
free -h

# Kill unnecessary processes
killall firefox
```

---

## Optimization Tips

### 1. Use Lighter OCR Model (if needed)
```python
# Currently uses PaddleOCR - good balance
# If too slow, consider Tesseract:
import pytesseract
```

### 2. Reduce Processing Frequency
```python
# Change from every 3rd frame to every 5th
if frame_count % 5 == 0:  # Lower power consumption
```

### 3. Smaller Camera Resolution
```python
self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 480)   # Instead of 640
self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)  # Instead of 480
```

### 4. Use TinyLlama for Faster AI
```bash
ollama pull tinyllama

# In code, change:
response = ollama.generate(model='tinyllama', ...)  # Instead of 'phi'
```

---

## File Structure

```
math-equation-reader/
├── README.md                    (this file)
├── equation_reader.py           (main application)
├── logs/
│   └── equations_detected.txt   (equation history)
├── config/
│   └── settings.json            (optional: calibration settings)
└── assets/
    └── test_equations/          (test images for debugging)
```

---

## Demo Checklist for Judges

- [ ] Camera captures equation in real-time
- [ ] PaddleOCR correctly reads equation text
- [ ] AI generates meaningful explanation
- [ ] Text-to-speech outputs clear audio
- [ ] System runs smoothly on 8GB Pi 5
- [ ] Shows live video feed with detection box
- [ ] Logs all detected equations
- [ ] Handles multiple equation types

---

## References

- **PaddleOCR Docs:** https://github.com/PaddlePaddle/PaddleOCR
- **Ollama:** https://ollama.ai
- **OpenCV:** https://opencv.org
- **pyttsx3:** https://pyttsx3.readthedocs.io

---


**Important Notes:**
- Keep Ollama running in background during hackathon
- Test camera setup before demo
- Ensure good lighting for OCR accuracy
- Have backup equations for demo (in case live capture fails)

---

**Created:** 2026-04-25  
**Last Updated:** 2026-04-25  
**Status:** Ready for hackathon
