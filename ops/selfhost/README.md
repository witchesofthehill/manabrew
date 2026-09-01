# Running your own relay

One binary. It is the lobby for a network and it holds the card art, so no
desktop has to download eight gigabytes of images and nobody types an address
to find it. Games run on whoever hosts the table, from the desktop app they
already have.

```sh
curl -LO https://github.com/witchesofthehill/manabrew/releases/latest/download/manabrew-server-linux-x86_64
chmod +x manabrew-server-linux-x86_64
sudo mv manabrew-server-linux-x86_64 /usr/local/bin/manabrew-server

sudo useradd --system --home /var/lib/manabrew manabrew
sudo cp manabrew-server.service /etc/systemd/system/
sudo systemctl enable --now manabrew-server
```

Then fill the cache once. It takes a while and about 11 GB, skips anything
already there, and can be interrupted and re-run:

```sh
sudo -u manabrew MANABREW_ART_DIR=/var/lib/manabrew \
  /usr/local/bin/manabrew-server --download-art
```

The desktops need no configuration at all. They find this machine over mDNS
and use it as their lobby and their source of card art.

## What it is not

It does not run games. The rules engine lives in the desktop app, which
updates itself; keeping it off the box in the cupboard is why that box needs
almost nothing from you. Whoever wants to play hosts the table.

## Settings

Statically linked, so it runs on any x86_64 Linux regardless of glibc.

| Variable                 | Default |                                                                                               |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------- |
| `MANABREW_ART_DIR`       | unset   | Hold card art here and serve `/scryfall-img/`. Unset serves none.                             |
| `MANABREW_ART_PORT`      | `9528`  | Where the art is served. Carried in the mDNS record, so clients need not be told.             |
| `MANABREW_LAN_ADVERTISE` | off     | Answer mDNS as this network's relay.                                                          |
| `MANABREW_SELF_UPDATE`   | off     | Replace this binary when a newer one is published, never while a game is running.             |
| `MANABREW_ART_BASE_URL`  | unset   | Only for a deployment behind a proxy, where the port this binds is not the one clients reach. |
| `FORGE_PORT`             | `9443`  | The lobby socket.                                                                             |

Anything on your network can answer mDNS and offer to be the lobby. That is
worth knowing on a network you do not control: being wrong means landing in a
lobby you did not expect, never that anyone can read your games or take your
name. If that matters, leave `MANABREW_LAN_ADVERTISE` off and point the
desktops at this machine in Settings.
