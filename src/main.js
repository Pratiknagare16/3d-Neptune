// ─────────────────────────────────────────────────────────────
//  NASA-Grade Interactive 3D Neptune Visualization — ULTRA
//  Three.js r0.161 · ES Modules · PBR + Custom Shaders
//  Rings · Triton · Volumetric Atmosphere · Bloom · Storms
// ─────────────────────────────────────────────────────────────

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ── Constants ──────────────────────────────────────────────
const NEPTUNE_RADIUS = 5;
const NEPTUNE_TILT = THREE.MathUtils.degToRad(28.32);
const TRITON_RADIUS = 0.45;
const TRITON_ORBIT_RADIUS = 12;
const TRITON_ORBIT_SPEED = 0.08;
const RING_INNER = 6.2;
const RING_OUTER = 9.5;

// ── Renderer ───────────────────────────────────────────────
const container = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// ── Scene ──────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);
scene.fog = new THREE.FogExp2(0x000008, 0.0015);

// ── Camera ─────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 8, 22);

// ── Controls ───────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.04;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.enablePan = false;
controls.rotateSpeed = 0.5;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.3;

// ── Texture Loader ─────────────────────────────────────────
const loader = new THREE.TextureLoader();

function loadTex(path, encoding) {
  const tex = loader.load(path);
  if (encoding === "srgb") tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ── Neptune Group (tilted) ─────────────────────────────────
const neptuneGroup = new THREE.Group();
neptuneGroup.rotation.z = NEPTUNE_TILT;
scene.add(neptuneGroup);

// ── Global State ───────────────────────────────────────────
const state = {
  showRings: true,
  showTriton: true,
  rotationSpeed: 1.0,
};

// ═════════════════════════════════════════════════════════
//  1. NEPTUNE SURFACE — Enhanced PBR + Procedural Storms
// ═════════════════════════════════════════════════════════
function createNeptune() {
  const geometry = new THREE.SphereGeometry(NEPTUNE_RADIUS, 128, 128);

  const albedoMap = loadTex("textures/neptune_surface.png", "srgb");
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshPhysicalMaterial({
    map: albedoMap,
    roughness: 1.0,
    metalness: 0.0,
    emissive: new THREE.Color(0x0a1a3f),
    emissiveIntensity: 0.35,
    clearcoat: 0.05,
    clearcoatRoughness: 0.9,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // ── Advanced atmospheric flow + procedural storm shader ──
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = { value: 0 };

    // Inject simplex noise + time
    shader.fragmentShader =
      `
      uniform float time;

      // Simplex-like hash noise
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289v2(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x_) - 0.5;
        vec3 ox = floor(x_ + 0.5);
        vec3 a0 = x_ - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      ` + shader.fragmentShader;

    // Replace map sampling with multi-layer distortion + storms
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        vec2 distortedUv = vMapUv;

        // --- Multi-frequency atmospheric band flow ---
        // Fast equatorial jets
        float lat = distortedUv.y - 0.5;
        float jetSpeed = cos(lat * 3.14159 * 2.0) * 0.006;
        distortedUv.x += jetSpeed * sin(distortedUv.y * 14.0 + time * 0.15);

        // Medium turbulence
        distortedUv.x += sin(distortedUv.y * 24.0 + time * 0.3) * 0.003;
        distortedUv.x += cos(distortedUv.y * 40.0 + time * 0.5) * 0.0012;

        // Subtle vertical oscillation
        distortedUv.y += sin(distortedUv.x * 8.0 + time * 0.1) * 0.001;

        vec4 sampledDiffuseColor = texture2D(map, distortedUv);

        // --- Procedural storm systems ---
        // Great Dark Spot analog
        vec2 stormCenter1 = vec2(0.35, 0.45);
        float storm1 = snoise(vec2(distortedUv.x * 6.0 + time * 0.02, distortedUv.y * 6.0));
        float stormMask1 = smoothstep(0.12, 0.0, length(distortedUv - stormCenter1));
        storm1 = storm1 * stormMask1 * 0.15;

        // Secondary smaller storm
        vec2 stormCenter2 = vec2(0.7, 0.55);
        float storm2 = snoise(vec2(distortedUv.x * 10.0 + time * 0.03, distortedUv.y * 10.0));
        float stormMask2 = smoothstep(0.07, 0.0, length(distortedUv - stormCenter2));
        storm2 = storm2 * stormMask2 * 0.1;

        // Evolving turbulence overlay
        float turb = snoise(vec2(distortedUv.x * 16.0 + time * 0.08, distortedUv.y * 16.0)) * 0.03;
        turb += snoise(vec2(distortedUv.x * 32.0 + time * 0.12, distortedUv.y * 32.0)) * 0.015;

        sampledDiffuseColor.rgb -= storm1 + storm2;
        sampledDiffuseColor.rgb += turb * vec3(0.3, 0.5, 0.8);

        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = vec4(mix(pow(sampledDiffuseColor.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), sampledDiffuseColor.rgb * 0.0773993808, vec3(lessThanEqual(sampledDiffuseColor.rgb, vec3(0.04045)))), sampledDiffuseColor.w);
        #endif
        diffuseColor *= sampledDiffuseColor;
      #endif
      `
    );

    mesh.userData.shader = shader;
  };

  return mesh;
}

// ═════════════════════════════════════════════════════════
//  2. ATMOSPHERE — Multi-layer Rayleigh Scattering
// ═════════════════════════════════════════════════════════
function createAtmosphere() {
  // --- Inner glow (Fresnel + Rayleigh) ---
  const innerGeo = new THREE.SphereGeometry(NEPTUNE_RADIUS + 0.25, 128, 128);
  const innerMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      void main() {
        float fresnel = 1.0 - dot(vNormal, vViewDir);
        // Rayleigh-like scattering with exponential falloff
        float rayleigh = pow(fresnel, 3.5);
        float scatter = pow(fresnel, 2.0) * 0.3;

        // Depth-based color: bluer at limb, slightly cyan near center
        vec3 limbColor = vec3(0.2, 0.45, 1.0);
        vec3 coreColor = vec3(0.15, 0.35, 0.85);
        vec3 atmColor = mix(coreColor, limbColor, fresnel);

        float alpha = rayleigh * 0.45 + scatter * 0.15;
        gl_FragColor = vec4(atmColor, alpha);
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });

  const innerMesh = new THREE.Mesh(innerGeo, innerMat);

  // --- Outer haze (volumetric feel) ---
  const outerGeo = new THREE.SphereGeometry(NEPTUNE_RADIUS + 0.7, 64, 64);
  const outerMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = 1.0 - dot(vNormal, vViewDir);
        float haze = pow(fresnel, 6.0);
        vec3 hazeColor = vec3(0.25, 0.5, 1.0);
        gl_FragColor = vec4(hazeColor, haze * 0.2);
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });

  const outerMesh = new THREE.Mesh(outerGeo, outerMat);

  const group = new THREE.Group();
  group.add(innerMesh, outerMesh);
  return group;
}

// ═════════════════════════════════════════════════════════
//  3. RING SYSTEM — Faint dusty arcs
// ═════════════════════════════════════════════════════════
function createRings() {
  // Procedural ring texture (canvas-based)
  const ringCanvas = document.createElement("canvas");
  ringCanvas.width = 1024;
  ringCanvas.height = 64;
  const ctx = ringCanvas.getContext("2d");

  for (let x = 0; x < 1024; x++) {
    const t = x / 1024;
    // Multiple faint ring bands
    let alpha = 0;
    // Galle ring
    alpha += Math.exp(-Math.pow((t - 0.15) * 20, 2)) * 0.25;
    // Le Verrier ring
    alpha += Math.exp(-Math.pow((t - 0.35) * 25, 2)) * 0.35;
    // Lassell ring (broad diffuse)
    alpha += Math.exp(-Math.pow((t - 0.52) * 8, 2)) * 0.15;
    // Arago ring
    alpha += Math.exp(-Math.pow((t - 0.65) * 30, 2)) * 0.2;
    // Adams ring (outermost, brightest)
    alpha += Math.exp(-Math.pow((t - 0.85) * 35, 2)) * 0.4;

    // Dusty noise
    alpha *= 0.6 + Math.random() * 0.4;

    const brightness = 120 + Math.random() * 40;
    ctx.fillStyle = `rgba(${brightness}, ${brightness + 20}, ${brightness + 40}, ${alpha})`;
    ctx.fillRect(x, 0, 1, 64);
  }

  const ringTexture = new THREE.CanvasTexture(ringCanvas);
  ringTexture.wrapS = THREE.ClampToEdgeWrapping;

  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 128, 1);
  // Fix UVs for radial mapping
  const uvs = ringGeo.attributes.uv;
  const pos = ringGeo.attributes.position;
  for (let i = 0; i < uvs.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const dist = Math.sqrt(x * x + y * y);
    uvs.setXY(i, (dist - RING_INNER) / (RING_OUTER - RING_INNER), 0.5);
  }

  const ringMat = new THREE.MeshBasicMaterial({
    map: ringTexture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;

  return ringMesh;
}

// ═════════════════════════════════════════════════════════
//  4. TRITON MOON — Icy retrograde moon
// ═════════════════════════════════════════════════════════
function createTriton() {
  const group = new THREE.Group();

  const geometry = new THREE.SphereGeometry(TRITON_RADIUS, 64, 64);
  const tritonMap = loadTex("textures/triton_surface.png", "srgb");

  const material = new THREE.MeshPhysicalMaterial({
    map: tritonMap,
    roughness: 0.85,
    metalness: 0.0,
    emissive: new THREE.Color(0x1a2a4a),
    emissiveIntensity: 0.2,
  });

  const tritonMesh = new THREE.Mesh(geometry, material);
  tritonMesh.castShadow = true;

  // Subtle atmosphere glow
  const glowGeo = new THREE.SphereGeometry(TRITON_RADIUS + 0.06, 32, 32);
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float f = 1.0 - dot(vNormal, vViewDir);
        f = pow(f, 4.0);
        gl_FragColor = vec4(0.5, 0.7, 1.0, f * 0.25);
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });

  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  group.add(tritonMesh, glowMesh);

  // Orbit path indicator
  const orbitCurve = new THREE.EllipseCurve(0, 0, TRITON_ORBIT_RADIUS, TRITON_ORBIT_RADIUS * 0.95, 0, Math.PI * 2, false, 0);
  const orbitPoints = orbitCurve.getPoints(128);
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
  const orbitMat = new THREE.LineBasicMaterial({
    color: 0x2244aa,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  const orbitLine = new THREE.Line(orbitGeo, orbitMat);
  orbitLine.rotation.x = -Math.PI / 2;

  return { tritonGroup: group, orbitLine };
}

// ═════════════════════════════════════════════════════════
//  5. STARFIELD — Multi-layer parallax + twinkling
// ═════════════════════════════════════════════════════════
function createStarfield() {
  const layers = [];
  const configs = [
    { count: 3000, minR: 150, maxR: 200, size: 0.6, speed: 0.0005, opacity: 0.7 },
    { count: 4000, minR: 200, maxR: 300, size: 0.4, speed: 0.0003, opacity: 0.5 },
    { count: 5000, minR: 300, maxR: 450, size: 0.25, speed: 0.0001, opacity: 0.35 },
  ];

  for (const cfg of configs) {
    const positions = new Float32Array(cfg.count * 3);
    const colors = new Float32Array(cfg.count * 3);
    const sizes = new Float32Array(cfg.count);

    for (let i = 0; i < cfg.count; i++) {
      const r = cfg.minR + Math.random() * (cfg.maxR - cfg.minR);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      sizes[i] = cfg.size * (0.5 + Math.random());

      // Color temperature variation
      const temp = Math.random();
      if (temp < 0.1) {
        // Hot blue
        colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 1.0;
      } else if (temp < 0.2) {
        // Warm yellow
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.92; colors[i * 3 + 2] = 0.7;
      } else if (temp < 0.25) {
        // Red giant
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.5;
      } else {
        // White
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Twinkling shader
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        baseOpacity: { value: cfg.opacity },
        pointSize: { value: cfg.size },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float time;
        uniform float pointSize;

        float hash(float n) { return fract(sin(n) * 43758.5453123); }

        void main() {
          vColor = color;
          // Per-star twinkle based on position hash
          float starId = position.x * 73.0 + position.y * 127.0 + position.z * 311.0;
          vTwinkle = 0.7 + 0.3 * sin(time * (1.0 + hash(starId) * 3.0) + hash(starId * 2.0) * 6.28);

          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = pointSize * size * (300.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float baseOpacity;

        void main() {
          // Soft circular point
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float softness = 1.0 - smoothstep(0.2, 0.5, dist);

          gl_FragColor = vec4(vColor, softness * baseOpacity * vTwinkle);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.userData.rotSpeed = cfg.speed;
    points.userData.material = material;
    layers.push(points);
  }

  return layers;
}

// ═════════════════════════════════════════════════════════
//  6. NEBULA DUST — Faint volumetric space dust
// ═════════════════════════════════════════════════════════
function createNebulaDust() {
  const count = 800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const palette = [
    [0.15, 0.2, 0.5],   // Deep blue
    [0.3, 0.15, 0.4],   // Purple
    [0.1, 0.3, 0.45],   // Teal
    [0.2, 0.25, 0.55],  // Indigo
  ];

  for (let i = 0; i < count; i++) {
    const r = 80 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    sizes[i] = 3.0 + Math.random() * 6.0;

    const c = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.06,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geometry, material);
}

// ═════════════════════════════════════════════════════════
//  7. LIGHTING — Cinematic HDR
// ═════════════════════════════════════════════════════════
function createLighting() {
  // Distant sunlight — physically motivated
  const sunLight = new THREE.DirectionalLight(0xfff8f0, 2.2);
  sunLight.position.set(25, 5, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 60;
  sunLight.shadow.camera.left = -15;
  sunLight.shadow.camera.right = 15;
  sunLight.shadow.camera.top = 15;
  sunLight.shadow.camera.bottom = -15;
  sunLight.shadow.bias = -0.0005;

  // Cool ambient — deep space
  const ambientLight = new THREE.AmbientLight(0x6677aa, 0.12);

  // Cold blue rim — Neptune's icy signature
  const rimLight = new THREE.DirectionalLight(0x2244bb, 0.4);
  rimLight.position.set(-15, 5, -15);

  // Subtle fill from below for visual depth
  const fillLight = new THREE.DirectionalLight(0x1a2255, 0.15);
  fillLight.position.set(0, -10, 5);

  return { sunLight, ambientLight, rimLight, fillLight };
}

// ═════════════════════════════════════════════════════════
//  8. SUN LENS FLARE (simple sprite)
// ═════════════════════════════════════════════════════════
function createSunSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,240,1)");
  grad.addColorStop(0.1, "rgba(255,250,220,0.8)");
  grad.addColorStop(0.3, "rgba(255,200,100,0.3)");
  grad.addColorStop(1, "rgba(255,150,50,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(25, 5, 20);
  sprite.scale.set(4, 4, 1);
  return sprite;
}

// ═════════════════════════════════════════════════════════
//  ASSEMBLE SCENE
// ═════════════════════════════════════════════════════════

// Neptune surface
const neptune = createNeptune();
neptuneGroup.add(neptune);

// Atmosphere glow
const atmosphere = createAtmosphere();
neptuneGroup.add(atmosphere);

// Rings
const rings = createRings();
neptuneGroup.add(rings);

// Triton
const { tritonGroup, orbitLine } = createTriton();
neptuneGroup.add(orbitLine);
// Triton orbits in the tilted reference frame
let tritonAngle = 0;
tritonGroup.position.set(TRITON_ORBIT_RADIUS, 0, 0);
neptuneGroup.add(tritonGroup);

// Starfield layers
const starLayers = createStarfield();
starLayers.forEach((l) => scene.add(l));

// Nebula dust
const nebula = createNebulaDust();
scene.add(nebula);

// Lighting
const { sunLight, ambientLight, rimLight, fillLight } = createLighting();
scene.add(sunLight, ambientLight, rimLight, fillLight);

// Sun sprite
const sunSprite = createSunSprite();
scene.add(sunSprite);

// ═════════════════════════════════════════════════════════
//  ANIMATION LOOP
// ═════════════════════════════════════════════════════════

const clockEl = document.getElementById("utc-clock");
let previousTime = performance.now() / 1000;
let elapsedTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const currentTime = performance.now() / 1000;
  const delta = Math.min(currentTime - previousTime, 0.1);
  previousTime = currentTime;
  elapsedTime += delta;

  const speed = state.rotationSpeed;

  // ── Neptune rotation ──
  neptune.rotation.y += delta * 0.12 * speed;

  // ── Atmospheric drift ──
  if (neptune.material.map) {
    neptune.material.map.offset.x += delta * 0.003 * speed;
  }

  // ── Storm shader time ──
  if (neptune.userData.shader) {
    neptune.userData.shader.uniforms.time.value += delta * speed;
  }

  // ── Ring visibility ──
  rings.visible = state.showRings;

  // ── Triton orbit (retrograde) ──
  tritonGroup.visible = state.showTriton;
  orbitLine.visible = state.showTriton;
  if (state.showTriton) {
    tritonAngle -= delta * TRITON_ORBIT_SPEED * speed; // retrograde
    tritonGroup.position.x = Math.cos(tritonAngle) * TRITON_ORBIT_RADIUS;
    tritonGroup.position.z = Math.sin(tritonAngle) * TRITON_ORBIT_RADIUS * 0.95;
    tritonGroup.position.y = Math.sin(tritonAngle * 0.3) * 0.5; // slight inclination wobble
    // Triton self-rotation
    tritonGroup.children[0].rotation.y += delta * 0.05;
  }

  // ── Starfield parallax rotation + twinkling ──
  for (const layer of starLayers) {
    layer.rotation.y += delta * layer.userData.rotSpeed;
    if (layer.userData.material) {
      layer.userData.material.uniforms.time.value = elapsedTime;
    }
  }

  // ── Nebula slow drift ──
  nebula.rotation.y += delta * 0.0002;
  nebula.rotation.x += delta * 0.0001;

  // ── UTC clock ──
  if (clockEl) {
    const now = new Date();
    clockEl.textContent =
      "UTC " +
      String(now.getUTCHours()).padStart(2, "0") +
      ":" +
      String(now.getUTCMinutes()).padStart(2, "0") +
      ":" +
      String(now.getUTCSeconds()).padStart(2, "0");
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();

// ═════════════════════════════════════════════════════════
//  RESIZE HANDLER
// ═════════════════════════════════════════════════════════

function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener("resize", onWindowResize);

// ═════════════════════════════════════════════════════════
//  UI INTERACTIONS
// ═════════════════════════════════════════════════════════

// ── Neptune Info Panel ──
const neptuneBtn = document.getElementById("neptuneBtn");
const neptunePanel = document.getElementById("neptunePanel");
const closePanel = document.getElementById("closePanel");

neptuneBtn.addEventListener("click", () => {
  neptunePanel.classList.add("visible");
});

closePanel.addEventListener("click", () => {
  neptunePanel.classList.remove("visible");
});

neptunePanel.addEventListener("click", (e) => {
  if (e.target === neptunePanel) {
    neptunePanel.classList.remove("visible");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    neptunePanel.classList.remove("visible");
  }
});

// ── Control Bar Interactions ──
const toggleRingsBtn = document.getElementById("toggleRings");
const toggleTritonBtn = document.getElementById("toggleTriton");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");

if (toggleRingsBtn) {
  toggleRingsBtn.addEventListener("click", () => {
    state.showRings = !state.showRings;
    toggleRingsBtn.classList.toggle("active", state.showRings);
    toggleRingsBtn.textContent = state.showRings ? "◉ Rings" : "○ Rings";
  });
}

if (toggleTritonBtn) {
  toggleTritonBtn.addEventListener("click", () => {
    state.showTriton = !state.showTriton;
    toggleTritonBtn.classList.toggle("active", state.showTriton);
    toggleTritonBtn.textContent = state.showTriton ? "◉ Triton" : "○ Triton";
  });
}

if (speedSlider) {
  speedSlider.addEventListener("input", () => {
    state.rotationSpeed = parseFloat(speedSlider.value);
    if (speedValue) speedValue.textContent = state.rotationSpeed.toFixed(1) + "×";
  });
}

// ── Camera Presets ──
const presetBtns = document.querySelectorAll("[data-preset]");
presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset;
    let target;
    switch (preset) {
      case "front":
        target = new THREE.Vector3(0, 0, 22);
        break;
      case "top":
        target = new THREE.Vector3(0, 25, 0.1);
        break;
      case "rings":
        target = new THREE.Vector3(15, 3, 10);
        break;
      case "triton":
        target = new THREE.Vector3(
          tritonGroup.position.x + 3,
          tritonGroup.position.y + 2,
          tritonGroup.position.z + 3
        );
        break;
      default:
        target = new THREE.Vector3(0, 8, 22);
    }
    animateCameraTo(target);
  });
});

function animateCameraTo(targetPos) {
  const start = camera.position.clone();
  const dur = 1500;
  const startTime = Date.now();

  function step() {
    const t = Math.min((Date.now() - startTime) / dur, 1);
    // Smooth ease-in-out
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(start, targetPos, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  step();
}
