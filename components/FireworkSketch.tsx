import React, { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { HandLandmarker } from "@mediapipe/tasks-vision";
import { createHandLandmarker } from '../services/mediapipe';
import { HandLandmark, HandLandmarkerResult } from '../types';

const FireworkSketch: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let myP5: p5 | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let animationFrameId: number;
    let lastVideoTime = -1;

    // --- Physics Classes for p5 ---
    
    class Particle {
      pos: p5.Vector;
      vel: p5.Vector;
      acc: p5.Vector;
      color: p5.Color;
      lifespan: number;
      decay: number;
      p: p5;

      constructor(p: p5, x: number, y: number, hue: number, explosion: boolean) {
        this.p = p;
        this.pos = p.createVector(x, y);
        this.lifespan = 255;
        this.color = p.color(hue, 255, 255);
        this.acc = p.createVector(0, 0);
        
        if (explosion) {
          this.vel = p5.Vector.random2D();
          // Increased explosion power for larger fireworks
          this.vel.mult(p.random(5, 22)); 
          // Slower decay for longer lasting particles
          this.decay = p.random(1.5, 4); 
        } else {
          this.vel = p.createVector(0, p.random(-12, -8));
          this.decay = 0;
        }
      }

      applyForce(force: p5.Vector) {
        this.acc.add(force);
      }

      update() {
        if (this.lifespan > 0) {
          this.vel.mult(0.92); // Slightly more air resistance for "burst then float" feel
          this.vel.add(this.acc);
          this.pos.add(this.vel);
          this.acc.mult(0);
          this.lifespan -= this.decay;
        }
      }

      show() {
        this.p.colorMode(this.p.HSB);
        // Thicker strokes for better visibility
        const size = this.lifespan > 200 ? 5 : 3; 
        this.p.strokeWeight(size);
        this.p.stroke(this.p.hue(this.color), 255, 255, this.lifespan / 255);
        this.p.point(this.pos.x, this.pos.y);
      }

      done() {
        return this.lifespan < 0;
      }
    }

    class Firework {
      p: p5;
      particles: Particle[];
      hue: number;
      done: boolean;

      constructor(p: p5, x: number, y: number) {
        this.p = p;
        this.hue = p.random(0, 360);
        this.particles = [];
        this.done = false;
        
        // Immediately explode for pinch gesture
        this.explode(x, y);
      }

      explode(x: number, y: number) {
        const count = 120; // Increased particle count for denser look
        for (let i = 0; i < count; i++) {
          this.particles.push(new Particle(this.p, x, y, this.hue, true));
        }
      }

      update() {
        // Reduced gravity for a floatier, larger feel
        const gravity = this.p.createVector(0, 0.15);
        for (let i = this.particles.length - 1; i >= 0; i--) {
          this.particles[i].applyForce(gravity);
          this.particles[i].update();
          if (this.particles[i].done()) {
            this.particles.splice(i, 1);
          }
        }
        if (this.particles.length === 0) {
          this.done = true;
        }
      }

      show() {
        for (const particle of this.particles) {
          particle.show();
        }
      }
    }

    // --- Main Logic ---

    const startApp = async () => {
      try {
        // 1. Setup Camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = () => {
                videoRef.current!.play();
                resolve(true);
              };
            }
          });
        }

        // 2. Setup MediaPipe
        handLandmarker = await createHandLandmarker();
        setLoading(false);

        // 3. Setup p5.js
        const sketch = (p: p5) => {
          let fireworks: Firework[] = [];
          
          // Tracking pinch state per hand to avoid continuous firing
          const handPinchStates = new Map<number, boolean>(); // Hand Index -> isPinched

          p.setup = () => {
            const w = videoRef.current?.videoWidth || window.innerWidth;
            const h = videoRef.current?.videoHeight || window.innerHeight;
            p.createCanvas(w, h);
            p.colorMode(p.HSB);
            p.frameRate(60);
          };

          p.draw = () => {
            p.clear(); // Transparent background so we see the video element behind

            // -- MediaPipe Detection Loop --
            if (handLandmarker && videoRef.current && videoRef.current.currentTime !== lastVideoTime) {
              lastVideoTime = videoRef.current.currentTime;
              const startTimeMs = performance.now();
              const detections: HandLandmarkerResult = handLandmarker.detectForVideo(videoRef.current, startTimeMs);

              if (detections.landmarks) {
                detections.landmarks.forEach((hand, index) => {
                  const thumbTip = hand[HandLandmark.THUMB_TIP];
                  const indexTip = hand[HandLandmark.INDEX_FINGER_TIP];

                  // Calculate distance (simple euclidean in 2D normalized space)
                  const dx = thumbTip.x - indexTip.x;
                  const dy = thumbTip.y - indexTip.y;
                  const distance = Math.sqrt(dx * dx + dy * dy);

                  // Threshold for pinch (tune this value)
                  const pinchThreshold = 0.05; 
                  const isPinched = distance < pinchThreshold;
                  const wasPinched = handPinchStates.get(index) || false;

                  if (isPinched && !wasPinched) {
                    // Trigger Firework!
                    // Coordinates are 0-1 normalized. Map to canvas size.
                    // We calculate the midpoint between thumb and index for the exact pinch center.
                    const midX = (thumbTip.x + indexTip.x) / 2;
                    const midY = (thumbTip.y + indexTip.y) / 2;

                    // Note: x is usually mirrored in CSS, but p5 coordinates are raw.
                    // If we mirror the video via CSS, we must ensure our p5 canvas is also mirrored 
                    // or we invert X here. 
                    // We are mirroring the CONTAINER, so X is relative to visual left.
                    const x = midX * p.width;
                    const y = midY * p.height;
                    
                    fireworks.push(new Firework(p, x, y));
                  }

                  handPinchStates.set(index, isPinched);

                  // Optional: Draw landmarks for debug/feedback
                  p.push();
                  p.noFill();
                  p.stroke(0, 0, 255, 0.4);
                  p.strokeWeight(4);
                  // Draw a small circle between fingers to hint at the active area
                  const midX = (thumbTip.x + indexTip.x) / 2;
                  const midY = (thumbTip.y + indexTip.y) / 2;
                  
                  if (distance < pinchThreshold * 2) {
                     p.stroke(0, 255, 255, 0.6); // Cyan when getting close
                     if (isPinched) p.stroke(100, 255, 255, 0.8); // Greenish/Bright when pinched
                     p.circle(midX * p.width, midY * p.height, 20);
                  }
                  
                  p.pop();
                });
              }
            }
            // -- End Detection --

            // Update and draw fireworks
            for (let i = fireworks.length - 1; i >= 0; i--) {
              fireworks[i].update();
              fireworks[i].show();
              if (fireworks[i].done) {
                fireworks.splice(i, 1);
              }
            }
          };

          p.windowResized = () => {
             if (videoRef.current) {
                p.resizeCanvas(videoRef.current.clientWidth, videoRef.current.clientHeight);
             }
          };
        };

        if (canvasRef.current) {
          myP5 = new p5(sketch, canvasRef.current);
        }

      } catch (err) {
        console.error("Initialization error:", err);
        setError("Could not access camera or load AI model.");
        setLoading(false);
      }
    };

    startApp();

    return () => {
      if (myP5) myP5.remove();
      if (handLandmarker) handLandmarker.close();
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      // Stop camera tracks
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden">
      {/* Video Background - Mirrored */}
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full object-cover mirror pointer-events-none"
        playsInline
        muted
        autoPlay
      />
      
      {/* P5 Canvas Overlay - Also Mirrored so coordinates match visually */}
      <div 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full mirror pointer-events-none"
      />

      {/* UI Overlay */}
      <div className="absolute top-4 left-4 z-50">
        <h1 className="text-white text-2xl font-bold drop-shadow-md">Hand Fireworks</h1>
        <p className="text-white/80 text-sm mt-1">Pinch index & thumb to explode!</p>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="flex flex-col items-center gap-4">
             <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
             <p className="text-white font-semibold">Loading Magic...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
          <div className="bg-red-900/50 p-6 rounded-lg text-center max-w-md border border-red-500">
            <h3 className="text-red-200 text-xl font-bold mb-2">Error</h3>
            <p className="text-red-100">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FireworkSketch;