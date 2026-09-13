"""Minimal Art-Net (ArtDmx) sender for a few low channels on one universe.

Packets carry Length = number of channels actually written (padded to an even
count, minimum 2, as the spec requires), so a sender for DMX 1..3 never
touches channels 4+ on the wire.
"""
import socket
import struct
import time

PORT = 6454
DEFAULT_GATEWAY = "2.0.0.100"
DEFAULT_BIND_IP = "2.0.0.1"


def build_packet(seq: int, universe: int, data: bytes, net: int = 0) -> bytes:
    if len(data) < 2 or len(data) % 2:
        data = data + bytes(max(2 - len(data), len(data) % 2))
    return (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
            + bytes([seq, 0, universe & 0xFF, net & 0x7F])
            + struct.pack(">H", len(data)) + data)


class Sender:
    def __init__(self, sock=None, gateway: str = DEFAULT_GATEWAY, universe: int = 1,
                 bind_ip: str | None = DEFAULT_BIND_IP, net: int = 0, pad_to: int = 0):
        if sock is None:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            if bind_ip:
                sock.bind((bind_ip, 0))
        self.sock = sock
        self.addr = (gateway, PORT)
        self.universe = universe
        self.net = net
        self._seq = 0
        self._last_len = 3
        self.pad_to = pad_to          # e.g. 512: always send full frames (some fixtures dislike short ones)

    def send(self, values) -> None:
        self._seq = (self._seq % 255) + 1
        data = bytes(max(0, min(255, int(round(v)))) for v in values)
        if self.pad_to and len(data) < self.pad_to:
            data = data + bytes(self.pad_to - len(data))
        self._last_len = len(data)
        self.sock.sendto(build_packet(self._seq, self.universe, data, self.net), self.addr)

    def blackout(self, repeats: int = 5, pause: float = 0.02, frame=None) -> None:
        """Send a dark frame a few times. Pass `frame` for rigs where all-zeros is unsafe
        (a moving head at pan/tilt 0 whips across the room): a parked frame with dimmer 0."""
        dark = list(frame) if frame is not None else [0] * self._last_len
        for _ in range(repeats):
            self.send(dark)
            if pause:
                time.sleep(pause)
