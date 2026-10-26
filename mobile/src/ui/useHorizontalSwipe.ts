import { useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';

// Le geste n'est capté qu'une fois nettement horizontal (CLAIM) et ne change
// de période qu'au-delà de THRESHOLD : un léger dérapage pendant un scroll
// vertical ne change jamais de mois.
export const SWIPE_CLAIM_DISTANCE = 16;
export const SWIPE_THRESHOLD = 60;
export const SWIPE_DIRECTION_RATIO = 2;

// onTouchStart reçoit un TouchEvent DOM brut sur le web (coordonnées dans
// changedTouches uniquement) : lecture unifiée natif/web.
function touchPoint(e: GestureResponderEvent) {
  const n = e.nativeEvent as GestureResponderEvent['nativeEvent'] & { changedTouches?: { pageX: number; pageY: number }[] };
  const t = n.changedTouches?.[0] ?? n;
  return { x: t.pageX, y: t.pageY };
}

/**
 * Handlers responder à étaler sur la zone balayable. Le responder n'est
 * réclamé (phase capture) que pour un geste nettement horizontal : un scroll
 * vertical reste géré par le ScrollView, et un élément touché au début d'un
 * swipe voit son appui annulé.
 */
export function useHorizontalSwipe(onSwipeLeft: (() => void) | undefined, onSwipeRight: (() => void) | undefined) {
  const start = useRef<{ x: number; y: number } | null>(null);

  function isHorizontal(e: GestureResponderEvent, minDistance: number) {
    if (!start.current) return false;
    const p = touchPoint(e);
    const dx = p.x - start.current.x;
    const dy = p.y - start.current.y;
    return Math.abs(dx) >= minDistance && Math.abs(dx) > SWIPE_DIRECTION_RATIO * Math.abs(dy);
  }

  return {
    onTouchStart: (e: GestureResponderEvent) => {
      start.current = touchPoint(e);
    },
    onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => isHorizontal(e, SWIPE_CLAIM_DISTANCE),
    onResponderTerminationRequest: () => false,
    onResponderRelease: (e: GestureResponderEvent) => {
      if (start.current && isHorizontal(e, SWIPE_THRESHOLD)) {
        if (touchPoint(e).x < start.current.x) onSwipeLeft?.();
        else onSwipeRight?.();
      }
      start.current = null;
    },
    onResponderTerminate: () => {
      start.current = null;
    },
  };
}
