// ============================================================================
// input.js — maps every input device to the ONE action: flap.
// Touch, mouse, and keyboard all collapse to a single callback. Kept separate
// from game logic so the iOS port can swap this out wholesale.
// ============================================================================

export function bindInput(target, onTap, onPause = () => {}) {
  // Pointer covers mouse + touch in one path; preventDefault stops the
  // synthetic double-tap zoom / scroll on mobile. Coords let the host decide
  // whether the tap hit the pause button or is a flap.
  const tap = (e) => {
    e.preventDefault();
    // preventDefault blocks the implicit focus, so take it explicitly —
    // otherwise keydown never reaches the page.
    if (target.focus) target.focus();
    const rect = target.getBoundingClientRect();
    // Pass the rendered box size too, so the host can scale into world units
    // even if a resize hasn't caught the latest safe-area insets.
    onTap(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  };

  target.addEventListener('pointerdown', tap, { passive: false });

  const onKey = (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      onPause();
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.key === ' ' || e.key === 'ArrowUp') {
      e.preventDefault();
      onTap(null, null, 0, 0); // keyboard = always a flap, no coords
    }
  };
  window.addEventListener('keydown', onKey, { passive: false });

  // Return an unbinder for cleanliness / future teardown.
  return () => {
    target.removeEventListener('pointerdown', tap);
    window.removeEventListener('keydown', onKey);
  };
}
