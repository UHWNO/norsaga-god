const WIDTH = 720,
  HEIGHT = 360;
export const AURORA_MIN_VALUE = 5;
// Presentation offset above coarse photorealistic tiles and weather shells;
// this is not a forecast of auroral altitude.
export const AURORA_DISPLAY_HEIGHT = 80_000;
const TYPE = 'AuroraForecast';

/** NOAA-style green/yellow/red ramp with enough contrast over satellite imagery. */
export function auroraColor(value) {
  if (value < AURORA_MIN_VALUE) return [0, 0, 0, 0];
  const stops = [
    [5, [40, 215, 20, 90]],
    [20, [30, 255, 0, 160]],
    [50, [235, 255, 0, 195]],
    [75, [255, 150, 0, 205]],
    [100, [255, 25, 0, 210]],
  ];
  const upper = stops.findIndex(([at]) => at >= value);
  if (upper <= 0) return [...stops[0][1]];
  const [low, a] = stops[upper - 1],
    [high, b] = stops[upper];
  const t = (value - low) / (high - low);
  return a.map((channel, i) => Math.round(channel + t * (b[i] - channel)));
}

/** Rasterize the one-degree samples with dateline wrapping and polar clipping. */
export function auroraPixels(cells) {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  let count = 0,
    north = 0,
    south = 0;
  for (const [lon, lat, value] of cells) {
    if (value < AURORA_MIN_VALUE) continue;
    count++;
    if (lat >= 0) north++;
    else south++;
    const color = auroraColor(value);
    const x = 2 * (lon + 180),
      y = 2 * (90 - lat);
    for (let dy = -1; dy <= 0; dy++) {
      if (y + dy < 0 || y + dy >= HEIGHT) continue;
      for (let dx = -1; dx <= 0; dx++) {
        const wrappedX = (x + dx + WIDTH) % WIDTH;
        pixels.set(color, ((y + dy) * WIDTH + wrappedX) * 4);
      }
    }
  }
  return { pixels, count, north, south, width: WIDTH, height: HEIGHT };
}

/** One static textured globe primitive, updated in place; no entities, timers or render holds. */
export function createAuroraRendering({
  viewer,
  cesium: C,
  createCanvas = () => document.createElement('canvas'),
}) {
  let primitive = null,
    material = null,
    canvas = null,
    destroyed = false;
  let counts = { count: 0, north: 0, south: 0 };
  let opacity = 0.9;
  const render = () => {
    if (!viewer.isDestroyed?.()) viewer.scene.requestRender?.();
  };
  function clear() {
    if (primitive) {
      viewer.scene.primitives.remove(primitive);
      if (!primitive.isDestroyed()) primitive.destroy();
    }
    primitive = null;
    if (material && !material.isDestroyed()) material.destroy();
    material = null;
    canvas = null;
    counts = { count: 0, north: 0, south: 0 };
    render();
  }
  return {
    setSnapshot(snapshot, { signal } = {}) {
      if (destroyed || signal?.aborted) return false;
      const raster = auroraPixels(snapshot.cells);
      if (!raster.count) {
        clear();
        return true;
      }
      const nextCanvas = createCanvas();
      nextCanvas.width = WIDTH;
      nextCanvas.height = HEIGHT;
      const context = nextCanvas.getContext('2d');
      if (!context) throw new Error('Aurora raster unavailable');
      const image = context.createImageData(WIDTH, HEIGHT);
      image.data.set(raster.pixels);
      context.putImageData(image, 0, 0);
      if (signal?.aborted) return false;
      if (!primitive) {
        const cache = C.Material._materialCache;
        if (!cache.getMaterial(TYPE))
          cache.addMaterial(TYPE, {
            fabric: {
              type: TYPE,
              uniforms: { image: C.Material.DefaultImageId, opacity: 0.9 },
              source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
              czm_material result = czm_getDefaultMaterial(materialInput);
              vec4 color = texture(image, materialInput.st);
              result.diffuse = vec3(0.0);
              result.emission = color.rgb;
              result.alpha = opacity * color.a * step(1.5, float(imageDimensions.x));
              return result;
            }`,
            },
            translucent: true,
          });
        material = C.Material.fromType(TYPE);
        primitive = new C.Primitive({
          geometryInstances: new C.GeometryInstance({
            geometry: new C.RectangleGeometry({
              rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90),
              height: AURORA_DISPLAY_HEIGHT,
              vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
            }),
          }),
          appearance: new C.EllipsoidSurfaceAppearance({
            material,
            aboveGround: true,
            flat: true,
            translucent: true,
            renderState: {
              depthTest: { enabled: true },
              depthMask: false,
              blending: C.BlendingState.ALPHA_BLEND,
            },
          }),
          asynchronous: false,
          allowPicking: false,
        });
        viewer.scene.primitives.add(primitive);
      }
      // A new identity triggers Cesium's upload and releases the old texture.
      canvas = nextCanvas;
      material.uniforms.image = canvas;
      material.uniforms.opacity = opacity;
      counts = {
        count: raster.count,
        north: raster.north,
        south: raster.south,
      };
      render();
      return true;
    },
    clear,
    setOpacity(value) {
      opacity = value;
      if (material) material.uniforms.opacity = opacity;
      render();
    },
    getDiagnostics() {
      return {
        ...counts,
        primitiveCount: primitive ? 1 : 0,
        canvasBytes: canvas ? WIDTH * HEIGHT * 4 : 0,
        displayHeight: AURORA_DISPLAY_HEIGHT,
        opacity,
        timerActive: false,
      };
    },
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
    },
  };
}
