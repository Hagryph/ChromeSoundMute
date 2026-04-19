(() => {
  const origToString = Function.prototype.toString;
  const toStringSpoofs = new WeakMap();

  const spoofedToString = function() {
    const cached = toStringSpoofs.get(this);
    if (cached !== undefined) return cached;
    return origToString.call(this);
  };
  toStringSpoofs.set(spoofedToString, origToString.call(origToString));
  try { Object.defineProperty(spoofedToString, 'name', { value: 'toString', configurable: true }); } catch {}
  Function.prototype.toString = spoofedToString;

  const registerSpoof = (fn, originalFn) => {
    try { toStringSpoofs.set(fn, origToString.call(originalFn)); } catch {}
    try {
      const origName = originalFn && originalFn.name;
      if (origName) Object.defineProperty(fn, 'name', { value: origName, configurable: true });
    } catch {}
  };

  const redefineGetter = (proto, prop, value) => {
    try {
      const origDesc = Object.getOwnPropertyDescriptor(proto, prop);
      const getter = function() { return value; };
      if (origDesc && origDesc.get) registerSpoof(getter, origDesc.get);
      Object.defineProperty(proto, prop, {
        configurable: origDesc ? origDesc.configurable : true,
        enumerable: origDesc ? origDesc.enumerable : true,
        get: getter,
      });
    } catch {}
  };

  redefineGetter(Document.prototype, 'hidden', false);
  redefineGetter(Document.prototype, 'webkitHidden', false);
  redefineGetter(Document.prototype, 'visibilityState', 'visible');
  redefineGetter(Document.prototype, 'webkitVisibilityState', 'visible');

  try {
    const origHasFocus = Document.prototype.hasFocus;
    const hasFocusSpoof = function() { return true; };
    registerSpoof(hasFocusSpoof, origHasFocus);
    Object.defineProperty(Document.prototype, 'hasFocus', {
      configurable: true,
      writable: true,
      value: hasFocusSpoof,
    });
  } catch {}

  const silenceEvent = function(ev) { try { ev.stopImmediatePropagation(); } catch {} };
  ['visibilitychange', 'webkitvisibilitychange', 'freeze', 'pagehide'].forEach(type => {
    try { document.addEventListener(type, silenceEvent, true); } catch {}
  });
  try { window.addEventListener('blur', silenceEvent, true); } catch {}

  const GESTURE_WINDOW_MS = 1200;
  let lastGesture = 0;
  const markGesture = () => { lastGesture = Date.now(); };
  const gestureEvents = ['pointerdown','mousedown','mouseup','touchstart','keydown','keyup','click'];
  const gestureOpts = { capture: true, passive: true };
  gestureEvents.forEach(ev => {
    try { window.addEventListener(ev, markGesture, gestureOpts); } catch {}
  });

  const allowProgrammaticPause = () => (Date.now() - lastGesture) <= GESTURE_WINDOW_MS;

  const origPause = HTMLMediaElement.prototype.pause;
  const origPlay = HTMLMediaElement.prototype.play;

  const guardedPause = function() {
    if (allowProgrammaticPause()) {
      return origPause.apply(this, arguments);
    }
    try {
      const p = origPlay.apply(this, []);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  };
  registerSpoof(guardedPause, origPause);
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: guardedPause,
  });

  const resumeIfPaused = (el) => {
    try {
      if (el && el.paused && el.readyState > 2) {
        const p = origPlay.call(el);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {}
  };

  document.addEventListener('pause', (ev) => {
    const el = ev.target;
    if (el instanceof HTMLMediaElement && !allowProgrammaticPause()) {
      try { ev.stopImmediatePropagation(); } catch {}
      resumeIfPaused(el);
    }
  }, true);

  const NativeIO = window.IntersectionObserver;
  if (typeof NativeIO === 'function') {
    const IOProxy = function(callback, options) {
      const wrapped = (entries, observer) => {
        const patched = entries.map((e) => {
          const t = e.target;
          const isVideoish = t && (
            t.tagName === 'VIDEO' ||
            (t.closest && t.closest('[data-a-target="player-overlay"],[data-a-target="player-container"],video'))
          );
          if (!isVideoish) return e;
          const rect = (t.getBoundingClientRect && t.getBoundingClientRect()) || e.boundingClientRect;
          return Object.assign({}, e, {
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
          });
        });
        try { return callback(patched, observer); } catch {}
      };
      return new NativeIO(wrapped, options);
    };
    IOProxy.prototype = NativeIO.prototype;
    registerSpoof(IOProxy, NativeIO);
    window.IntersectionObserver = IOProxy;
  }

  const pickMouseTarget = () => {
    return document.querySelector('video')
      || document.querySelector('[data-a-target="player-container"]')
      || document.body
      || document.documentElement;
  };

  const fireMouseMove = () => {
    try {
      const target = pickMouseTarget();
      if (!target) return;
      const rect = target.getBoundingClientRect
        ? target.getBoundingClientRect()
        : { left: 0, top: 0, width: 800, height: 600 };
      const x = rect.left + Math.random() * Math.max(rect.width, 100);
      const y = rect.top + Math.random() * Math.max(rect.height, 100);
      const ev = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      target.dispatchEvent(ev);
    } catch {}
  };

  const scheduleNextMouseMove = () => {
    const delay = 30000 + Math.random() * 60000;
    setTimeout(() => {
      fireMouseMove();
      scheduleNextMouseMove();
    }, delay);
  };
  setTimeout(scheduleNextMouseMove, 15000);
})();
