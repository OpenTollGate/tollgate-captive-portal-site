import { useRef, useEffect } from 'preact/hooks';

interface Particle {
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  size: number;
  color: string;
}

export default function ParticleBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf = 0;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }

    function createParticle(): Particle {
      const cx = canvas!.width / 2;
      const cy = canvas!.height / 2;
      const x = Math.random() * canvas!.width;
      const y = Math.random() * canvas!.height;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      const eased = Math.pow(dist / maxDist, 2);
      return {
        x,
        y,
        size: (Math.random() * 2.25 + 1) * (1 + eased),
        speedX: (Math.random() - 0.5) / 1.4,
        speedY: (Math.random() - 0.5) / 1.4,
        color: `rgba(255,255,255,${Math.random() * 0.5 + 0.1})`,
      };
    }

    function initParticles() {
      resize();
      particles = [];
      const count = Math.floor((canvas!.width + canvas!.height) / 16);
      for (let i = 0; i < count; i++) {
        particles.push(createParticle());
      }
    }

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0) p.x = canvas!.width;
        if (p.x > canvas!.width) p.x = 0;
        if (p.y < 0) p.y = canvas!.height;
        if (p.y > canvas!.height) p.y = 0;

        ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx!.strokeStyle = `rgba(255,255,255,${0.2 - dist / 500})`;
            ctx!.lineWidth = 0.5;
            ctx!.beginPath();
            ctx!.moveTo(p.x, p.y);
            ctx!.lineTo(q.x, q.y);
            ctx!.stroke();
          }
        }
      }

      raf = requestAnimationFrame(animate);
    }

    initParticles();
    animate();

    const onResize = () => {
      initParticles();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="bg-canvas"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
