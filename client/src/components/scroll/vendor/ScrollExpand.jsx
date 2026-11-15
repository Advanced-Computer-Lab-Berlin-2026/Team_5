'use client';

import { useCallback, useEffect, useRef } from 'react';

import './ScrollExpand.css';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

const ScrollExpand = ({
  src = '',
  mediaType = 'image',
  poster = '',
  alt = '',
  title = '',
  scrollHint = '',
  startWidth = 42,
  startHeight = 58,
  startRadius = 24,
  endRadius = 0,
  mediaZoom = 1.35,
  scrollDistance = 1.2,
  holdDistance = 0.35,
  smoothing = 0.1,
  overlayScrim = 0.45,
  useWindowScroll = false,
  enabled = true,
  fitContent = false,
  accountAnchorId,
  children,
  className = '',
  style,
  ...rest
}) => {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const mediaRef = useRef(null);
  const titleRef = useRef(null);
  const overlayRef = useRef(null);
  const scrimRef = useRef(null);
  const hintRef = useRef(null);

  const propsRef = useRef({});
  propsRef.current = {
    startWidth,
    startHeight,
    startRadius,
    endRadius,
    mediaZoom,
    scrollDistance,
    holdDistance,
    smoothing,
    overlayScrim,
    useWindowScroll,
    enabled,
    fitContent
  };

  const applyProgress = useCallback(p => {
    const frame = frameRef.current;
    const media = mediaRef.current;
    if (!frame || !media) return;
    const c = propsRef.current;

    const e = smoothstep(0, 1, p);

    const w = c.startWidth + (100 - c.startWidth) * e;
    const h = c.startHeight + (100 - c.startHeight) * e;
    const ix = Math.max(0, (100 - w) / 2);
    const iy = Math.max(0, (100 - h) / 2);
    const r = c.startRadius + (c.endRadius - c.startRadius) * e;
    frame.style.clipPath = `inset(${iy}% ${ix}% ${iy}% ${ix}% round ${r}px)`;

    media.style.transform = `scale(${c.mediaZoom + (1 - c.mediaZoom) * e})`;

    if (scrimRef.current) scrimRef.current.style.opacity = `${c.overlayScrim * e}`;

    if (titleRef.current) {
      const out = smoothstep(0.4, 0.88, p);
      titleRef.current.style.opacity = `${1 - out}`;
      titleRef.current.style.transform = `translate3d(0, ${-28 * out}px, 0) scale(${1 + 0.06 * out})`;
    }

    if (hintRef.current) {
      const gone = smoothstep(0, 0.12, p);
      hintRef.current.style.opacity = `${1 - gone}`;
      hintRef.current.style.transform = `translate3d(0, ${8 * gone}px, 0)`;
      hintRef.current.inert = gone > 0.95;
      hintRef.current.setAttribute('aria-hidden', gone > 0.95 ? 'true' : 'false');
    }

    if (overlayRef.current) {
      const inn = smoothstep(0.68, 1, p);
      overlayRef.current.style.opacity = `${inn}`;
      overlayRef.current.style.transform = `translate3d(0, ${18 * (1 - inn)}px, 0)`;
      // Hidden reveal actions must not receive keyboard focus or pointer input.
      overlayRef.current.inert = inn < 0.95;
      overlayRef.current.setAttribute('aria-hidden', inn < 0.95 ? 'true' : 'false');
      overlayRef.current.style.visibility = inn > 0.01 ? 'visible' : 'hidden';
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!root || !track || !stage) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let current = 0;
    let target = 0;
    let stageH = 0;
    let viewportH = 0;
    let running = false;
    let focusedReveal = false;

    const measure = () => {
      const c = propsRef.current;
      viewportH = c.useWindowScroll ? window.innerHeight : root.clientHeight;
      const overlay = overlayRef.current;
      const padding = overlay ? getComputedStyle(overlay) : null;
      const contentH = c.fitContent && overlay?.firstElementChild ? overlay.firstElementChild.getBoundingClientRect().height + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom) : 0;
      stageH = Math.max(viewportH, contentH);
      if (stageH <= 0) return;
      stage.style.height = `${stageH}px`;
      track.style.height = `${stageH + viewportH * (Math.max(0, c.scrollDistance) + Math.max(0, c.holdDistance))}px`;
      root.style.setProperty('--se-account-offset', `${viewportH * Math.max(0, c.scrollDistance)}px`);
      stage.style.setProperty('--se-viewport-height', `${viewportH}px`);

      const w = root.clientWidth || stageH;
      stage.style.setProperty('--se-title-size', `${clamp(w * 0.075, 20, 84)}px`);
    };

    const readProgress = () => {
      const c = propsRef.current;
      if (!c.enabled || focusedReveal) return 1;
      const span = viewportH * Math.max(0.01, c.scrollDistance);
      if (c.useWindowScroll) {
        const top = track.getBoundingClientRect().top;
        return clamp(-top / span, 0, 1);
      }
      return clamp(root.scrollTop / span, 0, 1);
    };

    const tick = () => {
      const c = propsRef.current;
      const k = c.smoothing <= 0 ? 1 : 1 - Math.exp(-1 / (60 * c.smoothing));
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.0004) {
        current = target;
        running = false;
      }
      applyProgress(current);
      raf = running ? requestAnimationFrame(tick) : 0;
    };

    const kick = () => {
      if (running) return;
      running = true;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      target = readProgress();
      if (propsRef.current.smoothing <= 0 || reduceMotion) {
        current = target;
        applyProgress(current);
        return;
      }
      kick();
    };

    const onResize = () => {
      const oldViewport = viewportH;
      const settings = propsRef.current;
      const accountOffset = oldViewport * Math.max(0, settings.scrollDistance);
      const atExpandedAccount = settings.useWindowScroll && target >= 0.999 && Math.abs(track.getBoundingClientRect().top + accountOffset) <= oldViewport * Math.max(0, settings.holdDistance) + 2;
      measure();
      // Preserve the expanded account position when rotating/resizing the viewport.
      // Natural form-height changes do not move the visitor's scroll position.
      if (atExpandedAccount && oldViewport && viewportH !== oldViewport) {
        window.scrollBy({ top: (viewportH - oldViewport) * Math.max(0, settings.scrollDistance), behavior: 'instant' });
      }
      target = readProgress();
      current = target;
      applyProgress(current);
    };

    // Native focus scrolling and mobile keyboards must not collapse an active form.
    // Explicit user scroll gestures release the hold, preserving reverse scrolling.
    const onFormFocus = () => {
      if (!propsRef.current.fitContent) return;
      focusedReveal = true;
      current = target = 1;
      applyProgress(1);
    };
    const releaseFocusHold = () => {
      if (!focusedReveal) return;
      focusedReveal = false;
      onScroll();
    };
    const onPointerDown = event => {
      if (!overlayRef.current?.contains(event.target)) releaseFocusHold();
    };
    const onNavigationKey = event => {
      if (event.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) releaseFocusHold();
    };

    measure();
    target = readProgress();
    current = target;
    applyProgress(current);

    const scroller = useWindowScroll ? window : root;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    overlayRef.current?.addEventListener('focusin', onFormFocus);
    window.addEventListener('wheel', releaseFocusHold, { passive: true });
    window.addEventListener('touchmove', releaseFocusHold, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onNavigationKey);
    const ro = new ResizeObserver(onResize);
    ro.observe(root);
    if (fitContent && overlayRef.current?.firstElementChild) ro.observe(overlayRef.current.firstElementChild);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      overlayRef.current?.removeEventListener('focusin', onFormFocus);
      window.removeEventListener('wheel', releaseFocusHold);
      window.removeEventListener('touchmove', releaseFocusHold);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onNavigationKey);
      ro.disconnect();
    };
  }, [applyProgress, useWindowScroll, fitContent]);

  const media =
    mediaType === 'video' ? (
      <video
        ref={mediaRef}
        className="scroll-expand__media"
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
      />
    ) : (
      <img ref={mediaRef} className="scroll-expand__media" src={src} alt={alt} draggable={false} />
    );

  return (
    <div
      ref={rootRef}
      className={`scroll-expand ${useWindowScroll ? '' : 'scroll-expand--scroller'} ${className}`.trim()}
      style={style}
      {...rest}
    >
      <div ref={trackRef} className="scroll-expand__track">
        {accountAnchorId && <span id={accountAnchorId} className="scroll-expand__account-anchor" aria-hidden="true" />}
        <div ref={stageRef} className="scroll-expand__stage">
          <div ref={frameRef} className="scroll-expand__frame">
            {media}
            <div ref={scrimRef} className="scroll-expand__scrim" />
            {children ? (
              <div ref={overlayRef} className="scroll-expand__overlay" inert aria-hidden="true">
                {children}
              </div>
            ) : null}
          </div>
          {title ? (
            <div ref={titleRef} className="scroll-expand__title">
              {title}
            </div>
          ) : null}
          {scrollHint ? (
            <div ref={hintRef} className="scroll-expand__hint">
              {scrollHint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ScrollExpand;

