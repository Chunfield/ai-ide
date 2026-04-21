import { useState, useCallback, useRef } from 'react';

interface ResizerProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
}

export function Resizer({ direction, onResize }: ResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pointerIdRef.current !== null) return;
    setIsDragging(true);
    pointerIdRef.current = e.pointerId;
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);

    const handlePointerMove = (ev: PointerEvent) => {
      if (pointerIdRef.current === null || ev.pointerId !== pointerIdRef.current) return;
      const currentPos = direction === 'horizontal' ? ev.clientX : ev.clientY;
      const delta = currentPos - startPosRef.current;
      startPosRef.current = currentPos;
      onResize(delta);
    };

    const cleanup = () => {
      pointerIdRef.current = null;
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }, [direction, onResize]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      className={`relative ${isHorizontal ? 'cursor-col-resize h-full' : 'cursor-row-resize w-full'} select-none touch-none`}
      style={isHorizontal ? { width: 8 } : { height: 8 }}
      onPointerDown={handlePointerDown}
    >
      <div
        className={`absolute ${isHorizontal ? 'inset-y-0 left-1/2 -translate-x-1/2' : 'inset-x-0 top-1/2 -translate-y-1/2'} transition-colors ${isDragging ? 'bg-[#007acc]' : 'bg-[#3c3c3c]'}`}
        style={isHorizontal ? { width: 2 } : { height: 2 }}
      />
      <div
        className={`absolute ${isHorizontal ? 'inset-y-0 left-1/2 -translate-x-1/2' : 'inset-x-0 top-1/2 -translate-y-1/2'} opacity-0 hover:opacity-100 transition-opacity bg-[#007acc]`}
        style={isHorizontal ? { width: 2 } : { height: 2 }}
      />
    </div>
  );
}
