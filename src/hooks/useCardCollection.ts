import { useEffect } from "react";

import { useAuthStore } from "@/stores/useAuthStore";
import { useCollectionStore } from "@/stores/useCollectionStore";

export function useCardCollection(): void {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const initialize = useCollectionStore((state) => state.initialize);

  useEffect(() => {
    void initialize(accountId);
  }, [accountId, initialize]);
}
