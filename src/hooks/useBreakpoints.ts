import { useMediaQuery } from "@/hooks/useMediaQuery";
import { COARSE_POINTER_QUERY, DESKTOP_QUERY, SHORT_SCREEN_QUERY } from "@/lib/responsive";

export function useIsTouch(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

export function useIsShortScreen(): boolean {
  return useMediaQuery(SHORT_SCREEN_QUERY);
}

export function useIsMobileGame(): boolean {
  const shortScreen = useIsShortScreen();
  const touch = useIsTouch();
  return shortScreen && touch;
}
