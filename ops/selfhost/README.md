# Running your own relay

One binary. It is the lobby for a network and it holds the card art, so no
desktop downloads eight gigabytes of images and nobody types an address to find
it. Games run on whoever hosts the table, from the desktop app they already
have; keeping the rules engine off this box is why it needs almost nothing.

```sh
curl -LO https://github.com/witchesofthehill/manabrew/releases/latest/download/manabrew-server-linux-x86_64
chmod +x manabrew-server-linux-x86_64
sudo mv manabrew-server-linux-x86_64 /usr/local/bin/manabrew-server
sudo useradd --system --home /var/lib/manabrew manabrew
sudo cp manabrew-server.service /etc/systemd/system/
sudo systemctl enable --now manabrew-server
```

Then fill the cache once. About 11 GB, skips what is already there, and can be
interrupted and re-run:

```sh
sudo -u manabrew MANABREW_ART_DIR=/var/lib/manabrew \
  /usr/local/bin/manabrew-server --download-art
```

The desktops need no configuration: they find this machine over mDNS and use it
as their lobby and their card art.

Statically linked, so it runs on any x86_64 Linux regardless of glibc.

| Variable                 | Default |                                                                         |
| ------------------------ | ------- | ----------------------------------------------------------------------- |
| `MANABREW_ART_DIR`       | unset   | Hold card art here and serve `/scryfall-img/`.                          |
| `MANABREW_ART_PORT`      | `9528`  | Carried in the mDNS record, so clients need not be told.                |
| `MANABREW_LAN_ADVERTISE` | off     | Answer mDNS as this network's relay.                                    |
| `MANABREW_ART_BASE_URL`  | unset   | Only behind a proxy, where the bound port is not the one clients reach. |
| `FORGE_PORT`             | `9443`  | The lobby socket.                                                       |

Anything on your network can answer mDNS and offer to be the lobby. Being wrong
means landing in a lobby you did not expect, never that anyone can read your
games or take your name. On a network you do not control, leave
`MANABREW_LAN_ADVERTISE` off and point the desktops here in Settings.
