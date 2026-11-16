'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

export function ToolEmbed({ src, probe, title, alt, offline }: { src: string; probe: string; title: string; alt: string; offline: string }) {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    fetch(probe, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
      .then(() => setUp(true))
      .catch(() => setUp(false))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [probe]);

  return (
    <>
      <div className={`frame${up ? '' : ' shot'}`}>
        {up
          ? <iframe src={src} title={title} loading="lazy" />
          : <Image src="/img/comparator-difference.png" alt={alt} width={1440} height={900} sizes="(max-width: 58rem) 100vw, 60vw" />}
      </div>
      {up === false && <figcaption>{offline}</figcaption>}
    </>
  );
}
