/**
 * Night Vision / NVG — PVS-14 Image Intensifier Emulation
 * P43 phosphor green, intensifier tube bloom, circular vignette,
 * scintillation noise, honeycomb pattern, auto-gain, HUD overlay.
 *
 * Exposed uniforms:
 *   gain (0-1)        — intensifier gain (bloom + noise balance)
 *   bloom (0-1)       — bloom/halo intensity around bright sources
 *   scanlineStr (0-1) — scanline intensity (kept for compatibility)
 *   pixelation (1-6)  — intensifier tube resolution pixelation
 */
export const nightVisionShader = {
  name: 'surveillance',
  uniforms: {
    gain: { default: 0.55, min: 0, max: 1, label: 'Gain' },
    bloom: { default: 0.3, min: 0, max: 1, label: 'Bloom' },
    scanlineStr: { default: 1.0, min: 0, max: 1, label: 'Scanlines' },
    pixelation: { default: 2.5, min: 1, max: 6, label: 'Pixelation' },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float time;
    uniform float gain;
    uniform float bloom;
    uniform float scanlineStr;
    uniform float pixelation;
    in vec2 v_textureCoordinates;

    // ── Noise functions ───────────────────────────────────
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // ── Barrel distortion (NVG lens) ──────────────────────
    vec2 barrelDistort(vec2 uv, float strength) {
      vec2 c = uv * 2.0 - 1.0;
      float r2 = dot(c, c);
      float distort = 1.0 + r2 * strength * 0.5 + r2 * r2 * strength * 0.15;
      c *= distort;
      return c * 0.5 + 0.5;
    }

    // ── Honeycomb pattern (fiber optic plate texture) ─────
    float honeycomb(vec2 uv) {
      vec2 dims = colorTextureDimensions;
      float scale = min(dims.x, dims.y) * 0.008;
      vec2 p = uv * dims * scale;
      // Hex grid
      vec2 r = vec2(1.0, 1.732);
      vec2 h = r * 0.5;
      vec2 a = mod(p, r) - h;
      vec2 b = mod(p - h, r) - h;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      float d = max(abs(gv.x), abs(gv.y * 0.577 + abs(gv.x) * 0.5));
      return smoothstep(0.4, 0.45, d);
    }

    // ── Crosshair (thin, subtle NVG reticle) ──────────────
    float crosshair(vec2 uv) {
      vec2 c = uv - 0.5;
      float h = smoothstep(0.001, 0.0004, abs(c.y)) *
                step(0.01, abs(c.x)) * step(abs(c.x), 0.025);
      float v = smoothstep(0.001, 0.0004, abs(c.x)) *
                step(0.01, abs(c.y)) * step(abs(c.y), 0.025);
      return clamp(h + v, 0.0, 1.0);
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec2 dims = colorTextureDimensions;
      vec2 texel = 1.0 / dims;

      // ── Barrel distortion (NVG lens distortion) ─────────
      float dist = 0.5 * intensity;
      vec2 distUV = barrelDistort(uv, dist);

      // ── Circular vignette mask (NVG tube field of view) ──
      vec2 centered = uv * 2.0 - 1.0;
      float aspect = dims.x / dims.y;
      centered.x *= aspect;
      float radius = length(centered);
      float tubeMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
      // Tube brightness falloff (center brightest)
      float tubeShading = 1.0 - radius * radius * 0.3;
      tubeShading = max(tubeShading, 0.0);

      // If outside tube, render black
      if (tubeMask < 0.001) {
        out_FragColor = vec4(vec3(0.0), 1.0);
        return;
      }

      // Black outside distorted area
      if (distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
        out_FragColor = vec4(vec3(0.0), 1.0);
        return;
      }

      // ── Intensifier tube resolution pixelation ────────────
      float pixSize = mix(1.0, pixelation, intensity);
      vec2 snappedUV = floor(distUV * dims / pixSize) * pixSize / dims;
      distUV = mix(distUV, snappedUV, intensity);

      vec4 original = texture(colorTexture, distUV);

      // ── Luminance ───────────────────────────────────────
      float luma = dot(original.rgb, vec3(0.299, 0.587, 0.114));

      // ── Auto-gain response ──────────────────────────────
      // Higher gain = more amplification, more noise, more bloom
      float gainLevel = mix(0.8, 2.5, gain);
      float amplified = clamp(luma * gainLevel, 0.0, 1.0);

      // Slight contrast curve for gain response
      amplified = pow(amplified, mix(1.2, 0.7, gain));

      // ── Intensifier tube bloom (THE key NVG visual) ─────
      // Bloom around bright sources — wider kernel for realistic halos
      float bloomAccum = 0.0;
      float bloomW = 0.0;
      for (int y = -5; y <= 5; y++) {
        for (int x = -5; x <= 5; x++) {
          vec2 offset = vec2(float(x), float(y)) * texel * 4.0;
          float sLuma = dot(texture(colorTexture, distUV + offset).rgb, vec3(0.299, 0.587, 0.114));
          float bright = smoothstep(0.4, 0.9, sLuma * gainLevel);
          float w = exp(-float(x * x + y * y) / 18.0);
          bloomAccum += bright * w;
          bloomW += w;
        }
      }
      bloomAccum /= bloomW;

      // Edge glow / corona on bright objects
      float corona = bloomAccum * bloom * 1.5;

      // ── P43 phosphor green (530nm) ──────────────────────
      vec3 phosphor = vec3(0.16, 1.0, 0.22);
      vec3 nvgColor = phosphor * (amplified + corona);

      // ── Scintillation (image intensifier sparkle noise) ──
      // Base tube grain (slow, coherent)
      vec2 grainCoord = uv * 120.0 + vec2(time * 0.5, time * 0.3);
      float tubeGrain = valueNoise(grainCoord);
      tubeGrain = (tubeGrain - 0.5) * mix(0.06, 0.2, gain) * intensity;
      nvgColor += phosphor * tubeGrain;

      // More noise in dark areas (real gain response)
      float darkNoise = (1.0 - amplified) * hash(uv * dims + vec2(time * 200.0, time * 300.0));
      nvgColor += phosphor * darkNoise * 0.08 * gain * intensity;

      // ── Honeycomb fiber optic plate ─────────────────────
      float hc = honeycomb(distUV);
      nvgColor *= 1.0 - hc * 0.04 * intensity; // very subtle

      // ── Scanlines (subtle, from the display) ────────────
      float scanline = sin(distUV.y * dims.y * 1.2 + time * 2.0) * 0.5 + 0.5;
      scanline = pow(scanline, 2.5);
      nvgColor *= 1.0 - scanline * scanlineStr * 0.15 * intensity;

      // ── Tube shading (brightness falloff from center) ───
      nvgColor *= tubeShading;

      // ── Circular vignette (dark edges, NVG tube shape) ──
      nvgColor *= tubeMask;

      // ── HUD Overlay ─────────────────────────────────────

      // Center crosshair (thin, subtle)
      float ch = crosshair(uv);
      nvgColor += phosphor * ch * 0.4 * intensity;

      // ── Final composite ─────────────────────────────────
      nvgColor = clamp(nvgColor, 0.0, 1.0);

      // Keep NVG output fully tube-masked at full intensity to avoid color bleed at the lens edge.
      vec3 finalColor = mix(original.rgb, nvgColor * tubeMask, intensity);

      out_FragColor = vec4(finalColor, 1.0);
    }
  `,
};
