// --- AUDIO ENGINE CORE STATE ---
let audioCtx = null;
let masterGainNode = null;
let masterFilter = null;
let delayNode = null;
let delayFeedback = null;

// Drone Voices (1-4) Setup
let droneOscs = [null, null, null, null];
let droneGains = [null, null, null, null];
let droneActive = [false, false, false, false];
let baseDroneFreqs = [65.41, 98.00, 130.81, 196.00];

// Performance Voices (7 & 8 Allocation Engine)
let isEnvLooping = false;
let activeLoopInterval = null;
let lastTriggeredPlateIndex = 0;

// Base fundamental tracking for scales (Root = C3 / 130.81Hz)
const rootFreq = 130.81;

// Scale tuning structural frameworks (Ratios or semi-tone offset tables)
const scales = {
    just: [1.0, 1.0417, 1.125, 1.20, 1.25, 1.3333, 1.4063, 1.50, 1.5625, 1.6667, 1.7778, 1.875], // Just Intonation
    pelog: [1.0, 1.075, 1.135, 1.220, 1.395, 1.50, 1.545, 1.660, 1.825, 1.910, 1.950, 1.995],    // Rough Web Audio approximations of Pelog spacing
    chromatic: [1.0, 1.0595, 1.1225, 1.1892, 1.2599, 1.3348, 1.4142, 1.4983, 1.5874, 1.6818, 1.7818, 1.8877] // Equal Temp
};

let currentScale = 'just';

// --- DOM ELEMENTS CACHE & SETUP ---
const startBtn = document.getElementById('start-btn');
const lockOverlay = document.getElementById('lock-overlay');
const xyPad = document.getElementById('xy-pad');
const xyCrosshair = document.getElementById('xy-crosshair');
const driftLed = document.getElementById('drift-led');
const scaleSelector = document.getElementById('scale-selector');
const loopToggleBtn = document.getElementById('loop-toggle');

const fxTimeInput = document.getElementById('fx-time');
const fxTimeValDisplay = document.getElementById('fx-time-val');
const masterGainInput = document.getElementById('master-gain');
const masterGainValDisplay = document.getElementById('master-vol-val');
const voiceDetuneInput = document.getElementById('voice-detune');
const detuneValDisplay = document.getElementById('detune-val');
const envAttackInput = document.getElementById('env-attack');
const envAttackValDisplay = document.getElementById('env-a-val');
const envDecayInput = document.getElementById('env-decay');
const envDecayValDisplay = document.getElementById('env-d-val');
const plateContainer = document.getElementById('plate-container');

// Dynamic Text updates helper
const updateVal = (element, text) => {
    if (element) element.innerText = text;
};

// --- BIND EVENT LISTENERS ---

// Fader listeners
fxTimeInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (delayNode && audioCtx) {
        delayNode.delayTime.setTargetAtTime(val, audioCtx.currentTime, 0.1);
    }
    updateVal(fxTimeValDisplay, val.toFixed(2) + 's');
});

masterGainInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (masterGainNode && audioCtx) {
        masterGainNode.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    }
    updateVal(masterGainValDisplay, Math.round(val * 100) + '%');
});

voiceDetuneInput.addEventListener('input', (e) => {
    updateVal(detuneValDisplay, e.target.value + 'c');
});

envAttackInput.addEventListener('input', (e) => {
    updateVal(envAttackValDisplay, parseFloat(e.target.value).toFixed(2) + 's');
});

envDecayInput.addEventListener('input', (e) => {
    updateVal(envDecayValDisplay, parseFloat(e.target.value).toFixed(2) + 's');
});

scaleSelector.addEventListener('change', (e) => {
    currentScale = e.target.value;
});

// Initialize Touchplate visual interface components
const buildTouchplates = () => {
    plateContainer.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const plate = document.createElement('div');
        plate.className = 'touchplate';
        plate.id = `plate-${i}`;
        plate.innerHTML = `<span>P${i + 1}</span>`;
        
        // Mouse triggers
        plate.addEventListener('mousedown', (e) => {
            e.preventDefault();
            triggerPerformanceVoice(i);
        });

        // Touch triggers
        plate.addEventListener('touchstart', (e) => {
            e.preventDefault();
            triggerPerformanceVoice(i);
        });
        
        plateContainer.appendChild(plate);
    }
};

// Initialize Astro Drone Audio Graph activation
startBtn.addEventListener('click', () => {
    if (!audioCtx) {
        initAudioGraph();
        startBtn.innerText = "ACTIVE";
        startBtn.classList.add('running');
        lockOverlay.style.opacity = '0';
        setTimeout(() => {
            lockOverlay.style.display = "none";
        }, 500);
    }
});

// --- CORE AUDIO INSTANTIATION GRAPH ---
function initAudioGraph() {
    // Create Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create Nodes
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.setValueAtTime(parseFloat(masterGainInput.value), audioCtx.currentTime);
    
    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    masterFilter.Q.setValueAtTime(3, audioCtx.currentTime);

    // Delay Network
    delayNode = audioCtx.createDelay(2.0);
    delayNode.delayTime.setValueAtTime(parseFloat(fxTimeInput.value), audioCtx.currentTime);
    
    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.setValueAtTime(0.4, audioCtx.currentTime);

    // Wiring Architecture
    masterFilter.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(masterFilter); // Feedback loop execution

    masterFilter.connect(masterGainNode);
    delayNode.connect(masterGainNode);
    masterGainNode.connect(audioCtx.destination);

    // Activate visual indicators
    if (driftLed) driftLed.classList.add('active', 'drift');

    // Begin subtle simulation background clock thread for real-time drift processing
    runDriftEngine();
}

// --- DRONE CORE ENGINE CONTROLS ---
window.toggleDrone = function(index) {
    if (!audioCtx) return;
    const btn = document.getElementById(`drone${index + 1}-toggle`);
    const card = btn.closest('.drone-card');

    if (!droneActive[index]) {
        // Instantiating Drone Osc Node
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        // Texture variations across voice slots
        osc.type = index % 2 === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(baseDroneFreqs[index], audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.5); // Anti-pop fade in

        osc.connect(gain);
        gain.connect(masterFilter);
        osc.start();

        droneOscs[index] = osc;
        droneGains[index] = gain;
        droneActive[index] = true;
        
        btn.classList.add('active');
        if (card) card.style.boxShadow = '0 0 15px rgba(255, 94, 0, 0.15)';
    } else {
        // Teardown sequence
        const targetGain = droneGains[index];
        const targetOsc = droneOscs[index];
        if (targetGain) {
            targetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            targetGain.gain.setValueAtTime(targetGain.gain.value, audioCtx.currentTime);
            targetGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
            setTimeout(() => {
                try { targetOsc.stop(); targetOsc.disconnect(); } catch (e) {}
            }, 400);
        }
        droneActive[index] = false;
        btn.classList.remove('active');
        if (card) card.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    }
};

window.updateDroneFreq = function(index, val) {
    baseDroneFreqs[index] = parseFloat(val);
    const valDisplay = document.getElementById(`v${index + 1}-pitch-val`);
    updateVal(valDisplay, val + ' Hz');
    if (droneActive[index] && droneOscs[index]) {
        droneOscs[index].frequency.setTargetAtTime(baseDroneFreqs[index], audioCtx.currentTime, 0.05);
    }
};

// Analog Drift Simulation loop
function runDriftEngine() {
    if (audioCtx) {
        const now = audioCtx.currentTime;
        for (let i = 0; i < 4; i++) {
            if (droneActive[i] && droneOscs[i]) {
                // Compute subtle microscopic frequency micro-deviations (vibrato drift)
                const drift = (Math.sin(now * (0.2 + i * 0.1)) * 0.18);
                droneOscs[i].frequency.setValueAtTime(baseDroneFreqs[i] + drift, now);
            }
        }
    }
    requestAnimationFrame(runDriftEngine);
}

// --- XY PAD INTERACTION HANDLING ---
function processXYMove(x, y) {
    if (!audioCtx) return;
    // X processing: Maps parameters directly to Filter Frequency Cutoff Range
    const minCutoff = 80;
    const maxCutoff = 6000;
    const targetCutoff = minCutoff + (x * (maxCutoff - minCutoff));
    masterFilter.frequency.setTargetAtTime(targetCutoff, audioCtx.currentTime, 0.04);

    // Y processing: Maps directly to Filter Resonance parameter
    const minRes = 0.5;
    const maxRes = 15;
    const targetRes = minRes + (y * (maxRes - minRes));
    masterFilter.Q.setTargetAtTime(targetRes, audioCtx.currentTime, 0.04);
}

// Mouse / Touch Event processing on XY Pad
function handleXYEvent(e) {
    const rect = xyPad.getBoundingClientRect();
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Invert Y direction for standard visual alignment maps (up is higher frequency/resonance)
    const y = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
    
    xyCrosshair.style.left = `${x * 100}%`;
    xyCrosshair.style.top = `${(1 - y) * 100}%`;
    
    processXYMove(x, y);
}

// Mouse Down/Move tracking for XY pad drag state
let isDraggingXY = false;

xyPad.addEventListener('mousedown', (e) => {
    isDraggingXY = true;
    handleXYEvent(e);
});

window.addEventListener('mousemove', (e) => {
    if (isDraggingXY) handleXYEvent(e);
});

window.addEventListener('mouseup', () => {
    isDraggingXY = false;
});

// Touch event tracking
xyPad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDraggingXY = true;
    handleXYEvent(e);
});

xyPad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isDraggingXY) handleXYEvent(e);
});

xyPad.addEventListener('touchend', () => {
    isDraggingXY = false;
});


// --- PERFORMANCE ENGINE (VOICES 7 & 8) ---
function triggerPerformanceVoice(plateIndex) {
    if (!audioCtx) return;
    lastTriggeredPlateIndex = plateIndex;

    // Compute Target Pitch directly from Selected Quantization Array Strategy
    const pitchMultiplier = scales[currentScale][plateIndex];
    const targetFrequency = rootFreq * pitchMultiplier;

    const now = audioCtx.currentTime;
    const attackTime = parseFloat(envAttackInput.value);
    const decayTime = parseFloat(envDecayInput.value);
    const detuneValue = parseFloat(voiceDetuneInput.value);

    // Build out dual tracking physical audio generation nodes
    const oscA = audioCtx.createOscillator();
    const oscB = audioCtx.createOscillator();
    const voiceGainNode = audioCtx.createGain();

    // Set up dual-wave stacking textures
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';

    oscA.frequency.setValueAtTime(targetFrequency, now);
    oscB.frequency.setValueAtTime(targetFrequency, now);
    
    // Apply real-time parameter detune matrix offsets to secondary core tracking node
    oscB.detune.setValueAtTime(detuneValue, now);

    // Formulate standard Envelope structures
    voiceGainNode.gain.setValueAtTime(0, now);
    voiceGainNode.gain.linearRampToValueAtTime(0.25, now + attackTime);
    voiceGainNode.gain.setValueAtTime(0.25, now + attackTime);
    voiceGainNode.gain.exponentialRampToValueAtTime(0.0001, now + attackTime + decayTime);

    // Wire everything up
    oscA.connect(voiceGainNode);
    oscB.connect(voiceGainNode);
    voiceGainNode.connect(masterFilter);

    oscA.start(now);
    oscB.start(now);

    // Handle visual key triggers UI accents
    const plateDOM = document.getElementById(`plate-${plateIndex}`);
    if (plateDOM) {
        plateDOM.classList.add('active');
        setTimeout(() => {
            plateDOM.classList.remove('active');
        }, (attackTime + 0.1) * 1000);
    }

    // Clean-up sequence handling memory allocation nodes directly
    const totalLifeDuration = (attackTime + decayTime + 0.5) * 1000;
    setTimeout(() => {
        try {
            oscA.stop();
            oscB.stop();
            oscA.disconnect();
            oscB.disconnect();
            voiceGainNode.disconnect();
        } catch (err) {}
    }, totalLifeDuration);
}

// Generative Looping Automation Thread Engine
window.toggleEnvLoop = function() {
    if (!isEnvLooping) {
        isEnvLooping = true;
        loopToggleBtn.innerText = "LOOP: ON";
        loopToggleBtn.classList.add('active');
        runPerformanceLoopIteration();
    } else {
        isEnvLooping = false;
        loopToggleBtn.innerText = "LOOP: OFF";
        loopToggleBtn.classList.remove('active');
        if (activeLoopInterval) clearTimeout(activeLoopInterval);
    }
};

function runPerformanceLoopIteration() {
    if (!isEnvLooping || !audioCtx) return;

    const attackTime = parseFloat(envAttackInput.value);
    const decayTime = parseFloat(envDecayInput.value);
    
    // Loop pattern selector: plays the next or adjacent notes randomly
    let nextPlate = lastTriggeredPlateIndex + (Math.random() > 0.4 ? 1 : -1);
    if (nextPlate > 11 || nextPlate < 0) {
        nextPlate = Math.floor(Math.random() * 12);
    }

    triggerPerformanceVoice(nextPlate);

    // Schedule the loop trigger rate relative to envelope execution lengths
    const cycleDuration = (attackTime + decayTime) * 0.72 * 1000;
    activeLoopInterval = setTimeout(runPerformanceLoopIteration, Math.max(cycleDuration, 200));
}

// Initialize touchplates on boot
buildTouchplates();
