import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useLocation } from "react-router-dom";

export interface TopBarOverride {
  locationKey: string;
  pathname: string;
  search: string;
  title?: string;
  onBack?: () => void;
  onHome?: () => void;
}

export const TopBarOverrideContext = createContext<
  Dispatch<SetStateAction<TopBarOverride | null>> | undefined
>(undefined);

interface TopBarOverrideOptions {
  title?: string;
  onBack?: () => void;
  onHome?: () => void;
}

export function useTopBarOverride({ title, onBack, onHome }: TopBarOverrideOptions) {
  const setOverride = useContext(TopBarOverrideContext);
  const location = useLocation();
  const backRef = useRef(onBack);
  const homeRef = useRef(onHome);
  const hasBack = onBack !== undefined;
  const hasHome = onHome !== undefined;
  const hasTitle = title !== undefined;

  useEffect(() => {
    backRef.current = onBack;
    homeRef.current = onHome;
  });

  useEffect(() => {
    if (!setOverride || (!hasTitle && !hasBack && !hasHome)) return;

    const override: TopBarOverride = {
      locationKey: location.key,
      pathname: location.pathname,
      search: location.search,
      title,
      onBack: hasBack ? () => backRef.current?.() : undefined,
      onHome: hasHome ? () => homeRef.current?.() : undefined,
    };
    setOverride(override);
    return () => setOverride((current) => (current === override ? null : current));
  }, [
    hasBack,
    hasHome,
    hasTitle,
    location.key,
    location.pathname,
    location.search,
    setOverride,
    title,
  ]);
}
