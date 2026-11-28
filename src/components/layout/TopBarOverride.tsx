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
  hidden?: boolean;
  title?: string;
  onHome?: () => void;
  navigationDisabled?: boolean;
}

export const TopBarOverrideContext = createContext<
  Dispatch<SetStateAction<TopBarOverride | null>> | undefined
>(undefined);

interface TopBarOverrideOptions {
  hidden?: boolean;
  title?: string;
  onHome?: () => void;
  navigationDisabled?: boolean;
}

export function useTopBarOverride({
  hidden,
  title,
  onHome,
  navigationDisabled,
}: TopBarOverrideOptions) {
  const setOverride = useContext(TopBarOverrideContext);
  const location = useLocation();
  const homeRef = useRef(onHome);
  const hasHome = onHome !== undefined;
  const hasTitle = title !== undefined;
  const hasNavigationDisabled = navigationDisabled !== undefined;

  useEffect(() => {
    homeRef.current = onHome;
  });

  useEffect(() => {
    if (!setOverride || (!hidden && !hasTitle && !hasHome && !hasNavigationDisabled)) return;

    const override: TopBarOverride = {
      locationKey: location.key,
      pathname: location.pathname,
      search: location.search,
      hidden,
      title,
      onHome: hasHome ? () => homeRef.current?.() : undefined,
      navigationDisabled,
    };
    setOverride(override);
    return () => setOverride((current) => (current === override ? null : current));
  }, [
    hasHome,
    hasNavigationDisabled,
    hasTitle,
    hidden,
    location.key,
    location.pathname,
    location.search,
    setOverride,
    title,
    navigationDisabled,
  ]);
}
