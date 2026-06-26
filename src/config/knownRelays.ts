export interface KnownRelay {
  name: string;
  host: string;
  port: number;
  password: string;
}

// The relay password is a shared access token, not a secret, so it lives in
// plaintext here and is shown in the UI.
export const KNOWN_RELAYS: KnownRelay[] = [
  {
    name: "Official Manabrew",
    host: "relay.manabrew.app",
    port: 443,
    password: "725c5fba479c4e59605e39988e31cb76813afa55cd1e71488c4dd2aae998164b",
  },
];
