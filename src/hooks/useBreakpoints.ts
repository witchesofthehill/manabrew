import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  COARSE_POINTER_QUERY,
  DESKTOP_QUERY,
  MOBILE_GAME_QUERY,
  SHORT_SCREEN_QUERY,
  TOUCH_CAPABLE_QUERY,
} from "@/lib/responsive";

export function useIsTouch(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

export function useHasTouchPointer(): boolean {
  return useMediaQuery(TOUCH_CAPABLE_QUERY);
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

export function useIsShortScreen(): boolean {
  return useMediaQuery(SHORT_SCREEN_QUERY);
}

export function useIsShortTouchScreen(): boolean {
  const shortScreen = useIsShortScreen();
  const touch = useIsTouch();
  return shortScreen && touch;
}

export function useIsMobileGame(): boolean {
  return useMediaQuery(MOBILE_GAME_QUERY);
}
