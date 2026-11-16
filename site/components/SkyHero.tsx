'use client';

import { useEffect, useRef, useState } from 'react';
import { asset } from '@/lib/config';

type Field = { slug: string; name: string; center: number[] };

export function SkyHero({ fields }: { fields: Field[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'live' | 'still'>('loading');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      if (disposed) return;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch {
        setState('still');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      el.prepend(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      camera.position.set(0, 0, 4.3);
      const globe = new THREE.Group();
      globe.rotation.x = 0.42;
      scene.add(globe);

      const nRa = 96, nDec = 48, pos: number[] = [], uv: number[] = [], idx: number[] = [];
      const onSphere = (raDeg: number, decDeg: number, r = 1) => {
        const a = (raDeg * Math.PI) / 180, d = (decDeg * Math.PI) / 180;
        return new THREE.Vector3(-r * Math.cos(d) * Math.sin(a), r * Math.sin(d), -r * Math.cos(d) * Math.cos(a));
      };
      for (let j = 0; j <= nDec; j++) for (let i = 0; i <= nRa; i++) {
        const ra = -180 + (360 * i) / nRa, dec = -90 + (180 * j) / nDec, p = onSphere(ra, dec);
        pos.push(p.x, p.y, p.z);
        uv.push(0.5 - ra / 360, j / nDec);
      }
      for (let j = 0; j < nDec; j++) for (let i = 0; i < nRa; i++) {
        const a = j * (nRa + 1) + i, b = a + 1, c = a + nRa + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
      globe.add(new THREE.Mesh(geo, mat));

      const ringGeo = new THREE.RingGeometry(0.026, 0.033, 40);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xe9b44c, side: THREE.DoubleSide });
      const seen = new Set<string>();
      for (const f of fields) {
        const key = f.center.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        const p = onSphere(f.center[0], f.center[1], 1.006);
        ring.position.copy(p);
        ring.lookAt(p.clone().multiplyScalar(2));
        globe.add(ring);
      }

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let spin = 2.2, visible = true, raf = 0, last = performance.now(), tiltX = 0, tiltY = 0;
      const draw = () => {
        globe.rotation.y = spin + tiltX;
        globe.rotation.x = 0.42 + tiltY;
        renderer.render(scene, camera);
      };
      const size = () => {
        const s = el.clientWidth;
        renderer.setSize(s, s, false);
        draw();
      };
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        spin += dt * 0.035;
        draw();
        raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
      };
      const start = () => { if (!raf && !reduce && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };

      const tex = new THREE.TextureLoader().load(
        asset('/sky/spherex_dr1_rgb_icrs_2048.jpg'),
        t => {
          if (disposed) return;
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
          setState('live');
          draw();
          start();
        },
        undefined,
        () => setState('still'),
      );

      const ro = new ResizeObserver(size);
      ro.observe(el);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); });
      io.observe(el);
      const onVis = () => start();
      document.addEventListener('visibilitychange', onVis);
      const onMove = (ev: PointerEvent) => {
        if (reduce) return;
        tiltX = (ev.clientX / window.innerWidth - 0.5) * 0.18;
        tiltY = (ev.clientY / window.innerHeight - 0.5) * 0.1;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      size();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointermove', onMove);
        geo.dispose(); mat.dispose(); ringGeo.dispose(); ringMat.dispose(); tex.dispose();
        renderer.dispose(); renderer.domElement.remove();
      };
      if (disposed) cleanup();
    })();

    return () => { disposed = true; cleanup(); };
  }, [fields]);

  return (
    <div ref={host} className="hero-sky" data-state={state} aria-hidden="true">
      <div className="still" />
    </div>
  );
}
