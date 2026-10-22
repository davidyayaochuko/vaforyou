import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

export type OrbMode = 'idle' | 'listening' | 'speaking';

type Props = {
  mode?: OrbMode;
  size?: number;
  className?: string;
  level?: number;
};

/**
 * Living water blob: noise-displaced icosphere, analytic normals,
 * inner caustic core, thin glass rim.
 */
export default function VoiceOrb({
  mode = 'idle',
  size = 520,
  className = '',
  level = 0,
}: Props) {
  return (
    <div
      className={`orb-canvas-wrap ${className}`}
      style={{ width: size, height: size, maxHeight: size }}
      role="img"
      aria-label={`Funke voice visualizer, ${mode}`}
    >
      <div className="orb-glow" aria-hidden="true" />
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.18, 4.6], fov: 35, near: 0.1, far: 50 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.12,
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
        <ambientLight intensity={0.32} />
        <directionalLight position={[3.8, 5.5, 2.8]} intensity={1.5} color="#f2fbff" />
        <directionalLight position={[-4.5, -1.5, -2.5]} intensity={0.5} color="#1aa87a" />
        <pointLight position={[0.2, 0.4, 3.4]} intensity={1.2} color="#7adfff" distance={14} />
        <pointLight position={[2.2, -2.4, -1.8]} intensity={0.55} color="#2f6b4f" distance={11} />
        <WaterBlob mode={mode} level={level} />
      </Canvas>
    </div>
  );
}

function WaterBlob({ mode, level }: { mode: OrbMode; level: number }) {
  const group = useRef<THREE.Group>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  const smooth = useRef({ amp: 0.14, turb: 0.9, spin: 0.11 });
  modeRef.current = mode;
  levelRef.current = level;

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.38, 6), []);
  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(1.445, 4), []);
  const coreGeo = useMemo(() => new THREE.IcosahedronGeometry(0.7, 3), []);

  const outerMat = useMemo(() => makeWaterMaterial(), []);
  const shellMat = useMemo(() => makeShellMaterial(), []);
  const coreMat = useMemo(() => makeCoreMaterial(), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const m = modeRef.current;
    const mic = Math.min(1, Math.max(0, levelRef.current));

    let amp = 0.13;
    let turb = 0.88;
    let spin = 0.08;
    if (m === 'listening') {
      amp = 0.2 + mic * 0.26;
      turb = 1.25 + mic * 0.45;
      spin = 0.18;
    } else if (m === 'speaking') {
      amp = 0.3;
      turb = 1.55;
      spin = 0.28;
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
      group.current.rotation.y = t * s.spin;
      group.current.rotation.x = Math.sin(t * 0.32) * 0.1;
      group.current.rotation.z = Math.cos(t * 0.26) * 0.07;
      const breathe = 1 + Math.sin(t * 0.85) * 0.028 + mic * 0.055;
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
        // Soft blob: swell dominates, drip is a whisper
        float d = swell * 0.62 + ripples * 0.28 + drip * 0.1;
        return d * uAmp * (1.0 + uLevel * 1.25);
      }

      void main() {
        float t = uTime;
        vec3 nrm = normalize(normal);
        float d = field(position, t);
        vec3 newPos = nrm * (length(position) * (1.0 + d));

        // Gradient of scalar field → smooth displaced normal
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
        float rim = fresnel * (0.4 + uLevel * 0.28);
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
        float glow = (1.0 - fresnel) * (0.28 + uLevel * 0.22);
        float bands = sin(vPos.y * 12.0 + uTime * 2.5) * 0.5 + 0.5;
        glow *= 0.7 + bands * 0.3;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
  });
}
