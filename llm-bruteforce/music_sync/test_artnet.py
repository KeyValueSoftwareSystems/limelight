import struct

import pytest

from artnet import build_packet, Sender


def test_packet_header_targets_universe_1_net_0():
    pkt = build_packet(seq=1, universe=1, data=bytes([10, 20, 30]))
    assert pkt[:8] == b"Art-Net\x00"
    assert struct.unpack("<H", pkt[8:10])[0] == 0x5000     # OpDmx
    assert struct.unpack(">H", pkt[10:12])[0] == 14        # protocol version
    assert pkt[12] == 1                                    # sequence
    assert pkt[13] == 0                                    # physical
    assert pkt[14] == 1                                    # SubUni
    assert pkt[15] == 0                                    # Net
    assert struct.unpack(">H", pkt[16:18])[0] == 4         # Length, padded to even per spec
    assert pkt[18:] == bytes([10, 20, 30, 0])


def test_packet_rejects_odd_or_short_data_by_padding_to_even_min_2():
    pkt = build_packet(seq=1, universe=1, data=bytes([255]))
    assert struct.unpack(">H", pkt[16:18])[0] == 2
    assert pkt[18:] == bytes([255, 0])


class FakeSocket:
    def __init__(self):
        self.sent = []

    def sendto(self, pkt, addr):
        self.sent.append((pkt, addr))


def test_sender_sends_only_three_channels_and_wraps_sequence():
    sock = FakeSocket()
    s = Sender(sock=sock, gateway="2.0.0.100", universe=1)
    for _ in range(256):
        s.send([1, 2, 3])
    assert len(sock.sent) == 256
    assert sock.sent[0][1] == ("2.0.0.100", 6454)
    assert sock.sent[0][0][12] == 1
    assert sock.sent[254][0][12] == 255
    assert sock.sent[255][0][12] == 1                      # wraps 255 -> 1, never 0
    assert struct.unpack(">H", sock.sent[0][0][16:18])[0] == 4  # 3 channels padded to even
    assert sock.sent[0][0][18:22] == bytes([1, 2, 3, 0])


def test_sender_clamps_and_rounds_values():
    sock = FakeSocket()
    s = Sender(sock=sock, gateway="2.0.0.100", universe=1)
    s.send([-5, 300, 127.6])
    assert sock.sent[0][0][18:21] == bytes([0, 255, 128])


def test_blackout_sends_zero_frames_repeatedly():
    sock = FakeSocket()
    s = Sender(sock=sock, gateway="2.0.0.100", universe=1)
    s.blackout(repeats=4, pause=0)
    assert len(sock.sent) == 4
    assert all(p[18:21] == bytes([0, 0, 0]) for p, _ in sock.sent)


def test_sender_pads_frames_to_pad_to_channels():
    sock = FakeSocket()
    s = Sender(sock=sock, gateway="2.0.0.100", universe=0, pad_to=512)
    s.send([1, 2, 3])
    assert struct.unpack(">H", sock.sent[0][0][16:18])[0] == 512
    assert sock.sent[0][0][18:21] == bytes([1, 2, 3]) and len(sock.sent[0][0]) == 18 + 512


def test_blackout_can_send_a_safe_park_frame_instead_of_zeros():
    sock = FakeSocket()
    s = Sender(sock=sock, gateway="2.0.0.100", universe=0)
    s.blackout(repeats=2, pause=0, frame=[0, 0, 0, 127, 127])
    assert len(sock.sent) == 2 and sock.sent[0][0][18:23] == bytes([0, 0, 0, 127, 127])
