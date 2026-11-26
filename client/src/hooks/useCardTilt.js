import { useEffect } from 'react';

// Tilts an element toward the pointer, like the item cards do. For elements the TiltedCard component can't wrap, such as dialogs
// whose height depends on what is inside them. Does nothing with touch or when reduced motion is on.
export function useCardTilt(ref, { max = 3, scale = 1.01 } = {}) {
    useEffect(() => {
        const element = ref.current;
        if (!element || !window.matchMedia('(hover: hover) and (pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
        const move = event => {
            const box = element.getBoundingClientRect();
            const x = (event.clientX - box.left) / box.width - 0.5;
            const y = (event.clientY - box.top) / box.height - 0.5;
            element.style.transition = 'transform 80ms linear';
            element.style.transform = `perspective(1100px) rotateX(${(-y * 2 * max).toFixed(2)}deg) rotateY(${(x * 2 * max).toFixed(2)}deg) scale(${scale})`;
        };
        const leave = () => {
            element.style.transition = 'transform 500ms cubic-bezier(0.23, 1, 0.32, 1)';
            element.style.transform = '';
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerleave', leave);
        return () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); element.style.transform = ''; element.style.transition = ''; };
    }, [ref, max, scale]);
}
