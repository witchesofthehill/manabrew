import { useNavigate } from "react-router-dom";
import { ForgeDuel } from "@/three/ForgeDuel";
import { AccountDuelSetup } from "@/three/AccountDuelSetup";
import { ROUTES } from "@/lib/constants";

export default function ArenaMatch() {
  const navigate = useNavigate();
  return (
    <ForgeDuel
      onExit={() => navigate(ROUTES.PLAY)}
      renderSetup={(start, loading) => <AccountDuelSetup onStart={start} disabled={loading} />}
    />
  );
}
