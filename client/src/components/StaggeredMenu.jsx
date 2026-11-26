import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import './StaggeredMenu.css';

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// React Bits StaggeredMenu, adapted for the site header: the toggle is a three-line icon that sits in
// the header, the panel is fixed to the viewport, and items can either link (link) or run an action (onSelect).
export const StaggeredMenu = ({
  position = 'right',
  colors = ['#f3a348', '#424242'],
  items = [],
  title,
  displayItemNumbering = true,
  className,
  accentColor,
  closeOnClickAway = true,
  onMenuOpen,
  onMenuClose
}) => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const panelRef = useRef(null);
  const preLayersRef = useRef(null);
  const preLayerElsRef = useRef([]);
  const toggleBtnRef = useRef(null);
  const closeBtnRef = useRef(null);
  const openTlRef = useRef(null);
  const closeTweenRef = useRef(null);
  const busyRef = useRef(false);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preContainer = preLayersRef.current;
      if (!panel) return;
      const preLayers = preContainer ? Array.from(preContainer.querySelectorAll('.sm-prelayer')) : [];
      preLayerElsRef.current = preLayers;
      const offscreen = position === 'left' ? -100 : 100;
      gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
      if (preContainer) gsap.set(preContainer, { xPercent: 0, opacity: 1 });
    });
    return () => ctx.revert();
  }, [position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }

    const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
    const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
    const offscreen = position === 'left' ? -100 : 100;

    if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    if (numberEls.length) gsap.set(numberEls, { '--sm-num-opacity': 0 });

    const tl = gsap.timeline({ paused: true });
    layers.forEach((el, i) => {
      tl.fromTo(el, { xPercent: offscreen }, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, i * 0.07);
    });
    const lastTime = layers.length ? (layers.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layers.length ? 0.08 : 0);
    const panelDuration = 0.65;
    tl.fromTo(panel, { xPercent: offscreen }, { xPercent: 0, duration: panelDuration, ease: 'power4.out' }, panelInsertTime);

    if (itemEls.length) {
      const itemsStart = panelInsertTime + panelDuration * 0.15;
      tl.to(itemEls, { yPercent: 0, rotate: 0, duration: 1, ease: 'power4.out', stagger: { each: 0.1, from: 'start' } }, itemsStart);
      if (numberEls.length) {
        tl.to(numberEls, { duration: 0.6, ease: 'power2.out', '--sm-num-opacity': 1, stagger: { each: 0.08, from: 'start' } }, itemsStart + 0.1);
      }
    }
    openTlRef.current = tl;
    return tl;
  }, [position]);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (tl) {
      tl.eventCallback('onComplete', () => { busyRef.current = false; });
      tl.timeScale(prefersReducedMotion() ? 12 : 1).play(0);
    } else {
      busyRef.current = false;
    }
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    const all = [...preLayerElsRef.current, panel];
    closeTweenRef.current?.kill();
    closeTweenRef.current = gsap.to(all, {
      xPercent: position === 'left' ? -100 : 100,
      duration: prefersReducedMotion() ? 0.01 : 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => {
        const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
        if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
        const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
        if (numberEls.length) gsap.set(numberEls, { '--sm-num-opacity': 0 });
        busyRef.current = false;
      }
    });
  }, [position]);

  const toggleMenu = useCallback(() => {
    const target = !openRef.current;
    openRef.current = target;
    setOpen(target);
    if (target) { onMenuOpen?.(); playOpen(); } else { onMenuClose?.(); playClose(); }
  }, [playOpen, playClose, onMenuOpen, onMenuClose]);

  const closeMenu = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    onMenuClose?.();
    playClose();
  }, [playClose, onMenuClose]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = event => {
      if (!closeOnClickAway) return;
      if (panelRef.current && !panelRef.current.contains(event.target) && toggleBtnRef.current && !toggleBtnRef.current.contains(event.target)) closeMenu();
    };
    const handleEscape = event => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeOnClickAway, open, closeMenu]);

  // when the menu opens the close button inside the panel (top left) takes focus; on close the toggle gets it back
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
    else if (wasOpen.current) toggleBtnRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const select = (event, item) => {
    if (!item.onSelect) return;
    // let modified clicks (new tab, etc.) behave like normal links
    if (item.link && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    closeMenu();
    item.onSelect();
  };

  const layerColors = (() => {
    const raw = colors && colors.length ? colors.slice(0, 4) : ['#1e1e22', '#35353c'];
    const arr = [...raw];
    if (arr.length >= 3) arr.splice(Math.floor(arr.length / 2), 1);
    return arr;
  })();

  return (
    <div
      className={(className ? className + ' ' : '') + 'staggered-menu-wrapper'}
      style={accentColor ? { ['--sm-accent']: accentColor } : undefined}
      data-position={position}
      data-open={open || undefined}
    >
      <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
        {layerColors.map((c, i) => <div key={i} className="sm-prelayer" style={{ background: c }} />)}
      </div>
      <button
        ref={toggleBtnRef}
        className="sm-toggle"
        aria-label={open ? 'Close settings menu' : 'Open settings menu'}
        aria-expanded={open}
        aria-controls="staggered-menu-panel"
        onClick={toggleMenu}
        type="button"
      >
        <span className="sm-burger" aria-hidden="true"><span /><span /><span /></span>
      </button>

      <aside id="staggered-menu-panel" ref={panelRef} className="staggered-menu-panel" aria-label="Settings" inert={!open}>
        <button ref={closeBtnRef} type="button" className="sm-close" aria-label="Close settings menu" onClick={closeMenu}>
          <span className="sm-burger" aria-hidden="true"><span /><span /><span /></span>
        </button>
        <div className="sm-panel-inner">
          {title && <p className="sm-panel-title">{title}</p>}
          <ul className="sm-panel-list" role="list" data-numbering={displayItemNumbering || undefined}>
            {items.map((it, idx) => (
              <li className="sm-panel-itemWrap" key={it.label + idx}>
                {it.link ? (
                  <a className="sm-panel-item" href={it.link} aria-label={it.ariaLabel} onClick={event => select(event, it)}>
                    <span className="sm-panel-itemLabel">{it.label}</span>
                  </a>
                ) : (
                  <button type="button" className="sm-panel-item" aria-label={it.ariaLabel} onClick={event => select(event, it)}>
                    <span className="sm-panel-itemLabel">{it.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
};

export default StaggeredMenu;
