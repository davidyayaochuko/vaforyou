import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  mode?: OrbMode;
  size?: number;
  className?: string;
  level?: number;
  /** Read every frame (live mic level). Overrides `level`. */
  levelSource?: () => number;
};

/**
 * Living water blob: noise-displaced icosphere, analytic normals,
 * inner caustic core, thin glass rim, soft sparkle field.
 */
export default function VoiceOrb({
  mode = 'idle',
  size = 520,
  className = '',
  level = 0,
  levelSource,
}: Props) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      className={`orb-canvas-wrap orb-mode-${mode} ${className}`}
      style={{ width: `min(${size}px, 82vw, 54vh)`, height: 'auto', aspectRatio: '1' }}
      data-mode={mode}
      role="img"
      aria-label={`Funke voice visualizer, ${mode}`}
    >
      <div className="orb-glow" aria-hidden="true" />
      <div className="orb-ring" aria-hidden="true" />
      <div className="orb-shadow" aria-hidden="true" />
      <Canvas
        dpr={reduced ? [1, 1.25] : [1, 2]}
        camera={{ position: [0, 0.18, 6.4], fov: 34, near: 0.1, far: 50 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.18,
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          zIndex: 1,
        }}
      >
        <ambientLight intensity={0.36} />
        <directionalLight position={[3.8, 5.5, 2.8]} intensity={1.55} color="#f5fcff" />
        <directionalLight position={[-4.5, -1.2, -2.2]} intensity={0.55} color="#1aa87a" />
        <pointLight position={[0.15, 0.5, 3.5]} intensity={1.35} color="#8ae6ff" distance={14} />
        <pointLight position={[2.4, -2.2, -1.6]} intensity={0.6} color="#2f6b4f" distance={12} />
        <pointLight position={[-2.2, 2.4, 1.2]} intensity={0.35} color="#a8f0d8" distance={10} />
        <WaterBlob mode={mode} level={level} levelSource={levelSource} reduced={reduced} />
        {!reduced ? <Sparkles mode={mode} level={level} levelSource={levelSource} /> : null}
      </Canvas>
    </div>
  );
}

function Sparkles({
  mode,
  level,
  levelSource,
}: {
  mode: OrbMode;
  level: number;
  levelSource?: () => number;
}) {
  const ref = useRef<THREE.Points>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  modeRef.current = mode;
  levelRef.current = level;

  const { positions, phases } = useMemo(() => {
    const count = 48;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 1.55 + Math.random() * 0.55;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      phases[i] = Math.random() * Math.PI * 2;
    }
    return { positions, phases };
  }, []);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: '#c8f7ff',
        size: 0.045,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const m = modeRef.current;
    const mic = levelSource ? levelSource() : levelRef.current;
    const boost =
      m === 'speaking' ? 1.35 : m === 'listening' ? 1.15 + mic * 0.4 : m === 'thinking' ? 1.05 : 0.85;
    mat.opacity = 0.28 * boost + Math.sin(t * 1.4) * 0.06;
    mat.size = 0.038 + (m === 'speaking' ? 0.02 : mic * 0.015);
    ref.current.rotation.y = t * (m === 'thinking' ? 0.32 : 0.06);
    const arr = ref.current.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < phases.length; i++) {
      const base = i * 3;
      const pulse = 1 + Math.sin(t * 1.8 + phases[i]!) * 0.04 * boost;
      // nudge along radius gently
      const x = positions[base]!;
      const y = positions[base + 1]!;
      const z = positions[base + 2]!;
      arr[base] = x * pulse;
      arr[base + 1] = y * pulse;
      arr[base + 2] = z * pulse;
    }
    ref.current.geometry.attributes.position!.needsUpdate = true;
  });

  return <points ref={ref} geometry={geom} material={mat} />;
}

function WaterBlob({
  mode,
  level,
  levelSource,
  reduced,
}: {
  mode: OrbMode;
  level: number;
  levelSource?: () => number;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  const smooth = useRef({ amp: 0.14, turb: 0.9, spin: 0.11 });
  modeRef.current = mode;
  levelRef.current = level;

  const detail = reduced ? 4 : 7;
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.38, detail), [detail]);
  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(1.448, reduced ? 3 : 5), [reduced]);
  const coreGeo = useMemo(() => new THREE.IcosahedronGeometry(0.74, 4), []);

  const outerMat = useMemo(() => makeWaterMaterial(), []);
  const shellMat = useMemo(() => makeShellMaterial(), []);
  const coreMat = useMemo(() => makeCoreMaterial(), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const m = modeRef.current;
    const raw = levelSource ? levelSource() : levelRef.current;
    const mic = Math.min(1, Math.max(0, raw));

    let amp = 0.09;
    let turb = 0.72;
    let spin = 0.055;
    if (m === 'listening') {
      amp = 0.16 + mic * 0.24;
      turb = 1.05 + mic * 0.4;
      spin = 0.14;
    } else if (m === 'thinking') {
      amp = 0.11;
      turb = 0.95;
      spin = 0.5;
    } else if (m === 'speaking') {
      amp = 0.16 + mic * 0.16;
      turb = 1.25;
      spin = 0.22;
    }

    const s = smooth.current;
    s.amp += (amp - s.amp) * 0.055;
    s.turb += (turb - s.turb) * 0.045;
    s.spin += (spin - s.spin) * 0.04;

    outerMat.uniforms.uTime!.value = t;
    outerMat.uniforms.uAmp!.value = s.amp;
    outerMat.uniforms.uTurb!.value = s.turb;
    outerMat.uniforms.uLevel!.value = mic;

    shellMat.uniforms.uTime!.value = t;
    shellMat.uniforms.uAmp!.value = s.amp * 0.9;
    shellMat.uniforms.uTurb!.value = s.turb;
    shellMat.uniforms.uLevel!.value = mic;

    coreMat.uniforms.uTime!.value = t;
    coreMat.uniforms.uLevel!.value = mic;

    if (group.current) {
      const drift = reduced ? 0.4 : 1;
      group.current.rotation.y = t * s.spin * drift;
      group.current.rotation.x = Math.sin(t * 0.32) * 0.1 * drift;
      group.current.rotation.z = Math.cos(t * 0.26) * 0.07 * drift;
      const breathe = 1 + Math.sin(t * 0.85) * 0.03 * drift + mic * 0.06;
      group.current.position.y = Math.sin(t * 0.55) * 0.04 * drift;
      group.current.scale.setScalar(breathe);
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={coreGeo} material={coreMat} renderOrder={0} />
      <mesh geometry={geometry} material={outerMat} renderOrder={1} />
      <mesh geometry={shellGeo} material={shellMat} renderOrder={2} />
    </group>
  );
}

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0.14 },
      uTurb: { value: 1.0 },
      uLevel: { value: 0 },
      uColorA: { value: new THREE.Color('#e8fcff') },
      uColorB: { value: new THREE.Color('#2bc4d6') },
      uColorC: { value: new THREE.Color('#168a58') },
      uColorDeep: { value: new THREE.Color('#0a4a38') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vDisplace;
      uniform float uTime;
      uniform float uAmp;
      uniform float uTurb;
      uniform float uLevel;

      vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
      vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
      float snoise(vec3 v){
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 1.0/7.0;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      float fbm(vec3 p) {
        float f = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          f += a * snoise(p);
          p = p * 2.03 + 17.1;
          a *= 0.5;
        }
        return f;
      }

      float field(vec3 pos, float t) {
        float swell = fbm(pos * (0.78 * uTurb) + vec3(0.0, t * 0.16, t * 0.12));
        float ripples = fbm(pos * (2.1 * uTurb) + vec3(t * 0.42, t * 0.32, -t * 0.28));
        float drip = fbm(pos * (3.6 * uTurb) - vec3(t * 0.7, t * 0.55, t * 0.4));
        float d = swell * 0.62 + ripples * 0.28 + drip * 0.1;
        return d * uAmp * (1.0 + uLevel * 1.25);
      }

      void main() {
        float t = uTime;
        vec3 nrm = normalize(normal);
        float d = field(position, t);
        vec3 newPos = nrm * (length(position) * (1.0 + d));

        float e = 0.035;
        vec3 grad = vec3(
          field(position + vec3(e, 0.0, 0.0), t) - field(position - vec3(e, 0.0, 0.0), t),
          field(position + vec3(0.0, e, 0.0), t) - field(position - vec3(0.0, e, 0.0), t),
          field(position + vec3(0.0, 0.0, e), t) - field(position - vec3(0.0, 0.0, e), t)
        ) / (2.0 * e);
        vec3 displacedN = normalize(nrm - grad);

        vDisplace = d;
        vNormal = normalize(normalMatrix * displacedN);
        vec4 world = modelMatrix * vec4(newPos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vDisplace;
      uniform float uTime;
      uniform float uLevel;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform vec3 uColorDeep;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float ndv = max(dot(N, V), 0.0);
        float fresnel = pow(1.0 - ndv, 3.1);
        float fresnelSoft = pow(1.0 - ndv, 1.5);

        float depth = clamp(0.42 + vDisplace * 2.4 + N.y * 0.28, 0.0, 1.0);
        vec3 body = mix(uColorDeep, uColorC, depth * 0.85);
        body = mix(body, uColorB, smoothstep(0.25, 0.85, depth));
        body = mix(body, uColorA, fresnelSoft * 0.78);

        vec3 L1 = normalize(vec3(0.55, 0.9, 0.35));
        vec3 L2 = normalize(vec3(-0.4, 0.3, 0.75));
        vec3 H1 = normalize(L1 + V);
        vec3 H2 = normalize(L2 + V);
        float spec1 = pow(max(dot(N, H1), 0.0), 96.0);
        float spec2 = pow(max(dot(N, H1), 0.0), 18.0);
        float spec3 = pow(max(dot(N, H2), 0.0), 48.0);

        vec3 col = body;
        col += vec3(0.92, 0.98, 1.0) * spec1 * 1.05;
        col += uColorB * spec2 * 0.28;
        col += uColorA * spec3 * 0.22;
        col += uColorA * fresnel * (0.62 + uLevel * 0.38);

        float shim =
          sin(vWorldPos.x * 7.2 + uTime * 2.0) *
          sin(vWorldPos.y * 5.6 - uTime * 1.55) *
          sin(vWorldPos.z * 4.8 + uTime * 1.1);
        shim = shim * 0.5 + 0.5;
        col += uColorB * shim * 0.085 * (1.0 - fresnel);

        float sss = pow(max(N.y * 0.5 + 0.5, 0.0), 1.4);
        col += uColorC * sss * 0.08 * (1.0 - fresnelSoft);

        float alpha = mix(0.8, 0.96, fresnelSoft);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function makeShellMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0.14 },
      uTurb: { value: 1.0 },
      uLevel: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      uniform float uTime;
      uniform float uAmp;
      uniform float uTurb;
      uniform float uLevel;

      vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
      vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
      float snoise(vec3 v){
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
                  i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 1.0/7.0;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      float fbm(vec3 p) {
        float f = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          f += a * snoise(p);
          p = p * 2.03 + 17.1;
          a *= 0.5;
        }
        return f;
      }

      void main() {
        vec3 nrm = normalize(normal);
        float swell = fbm(position * (0.82 * uTurb) + vec3(0.0, uTime * 0.18, uTime * 0.14));
        float ripples = fbm(position * (2.4 * uTurb) + vec3(uTime * 0.45, uTime * 0.3, -uTime * 0.28));
        float d = (swell * 0.55 + ripples * 0.35) * uAmp * (1.0 + uLevel * 1.3);
        vec3 newPos = nrm * (length(position) * (1.0 + d));
        vNormal = normalize(normalMatrix * nrm);
        vec4 world = modelMatrix * vec4(newPos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      uniform float uLevel;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        float rim = fresnel * (0.42 + uLevel * 0.3);
        gl_FragColor = vec4(0.72, 0.94, 1.0, rim);
      }
    `,
  });
}

function makeCoreMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColor: { value: new THREE.Color('#3de0c0') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vPos;
      uniform float uTime;

      void main() {
        float pulse = 1.0 + sin(uTime * 1.4) * 0.045;
        vec3 newPos = position * pulse;
        vPos = newPos;
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(newPos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vPos;
      uniform float uTime;
      uniform float uLevel;
      uniform vec3 uColor;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 1.8);
        float glow = (1.0 - fresnel) * (0.3 + uLevel * 0.25);
        float bands = sin(vPos.y * 12.0 + uTime * 2.5) * 0.5 + 0.5;
        glow *= 0.7 + bands * 0.3;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
  });
}
