import React, { useEffect, useRef } from 'react';

import './Background.scss';

const Background = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Particle class for the moving light effect
    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        // Calculate distance from window center
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const dx = this.x - centerX;
        const dy = this.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // Normalize distance (0 at center, 1 at farthest corner)
        const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
        const distanceFactor = distance / maxDistance;
        // Size increases slowly at first, then faster the farther from center (ease-in)
        const easedDistance = Math.pow(distanceFactor, 2); // quadratic ease-in
        this.size = (Math.random() * 2.25 + 1) * (1 + easedDistance);
        this.speedX = (Math.random() - 0.5) / 1.4;
        this.speedY = (Math.random() - 0.5) / 1.4;
        this.color = `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.1})`;
      }
      
      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        
        // Wrap around edges
        if (this.x < 0) this.x = canvas.width;
        if (this.x > canvas.width) this.x = 0;
        if (this.y < 0) this.y = canvas.height;
        if (this.y > canvas.height) this.y = 0;
      }
      
      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let particlesArray = [];
    const createParticles = () => {
      // Create particle array
      const particleCount = (window.innerWidth + window.innerHeight) / 16;
      
      for (let i = 0; i < particleCount; i++) {
        particlesArray.push(new Particle());
      }
    }
    
    // Set canvas dimensions to match window
    let resizeTimer;
    const reinit = () => {
      particlesArray = [];
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        createParticles();
      }, 200)
    };
    
    reinit();
    window.addEventListener('resize', reinit);
    
    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw particles
      particlesArray.forEach(particle => {
        particle.update();
        particle.draw();
      });
      
      // Draw lines between close particles
      for (let i = 0; i < particlesArray.length; i++) {
        for (let j = i; j < particlesArray.length; j++) {
          const dx = particlesArray[i].x - particlesArray[j].x;
          const dy = particlesArray[i].y - particlesArray[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < 100) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 - distance/500})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
            ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
            ctx.stroke();
          }
        }
      }
      
      requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      window.removeEventListener('resize', reinit);
    };
  }, []);

  return <canvas ref={canvasRef} className="tollgate-captive-portal-background"></canvas>
}

export default Background; 