// Limelight sim -- a lightweight native DMX visualiser.  OWNER: Alnas.
//
//   ./sim [scene.json] [--universe N]
//
// Reads a scene produced by gen_scene.py (fixtures: position, aim, beam angle,
// DMX patch) and renders them live from sACN (E1.31) on universe 1. Far lighter
// than Blender: one small window, raw GPU draw, direct UDP -- no bridge.
//
// v1: proxy bodies + beam cones (aimed by each fixture's FocusPoint, or by
// pan/tilt for movers), coloured/dimmed by the live DMX. Real .glb models and
// full geometry-tree animation are the next pass.
//
// Coords: scene is Z-up metres (x=width, y=depth, z=height). raylib is Y-up, so
// we swap y/z at the draw boundary (ry()).
#include "raylib.h"
#include "raymath.h"
#include "vendor/json.hpp"
#include <array>
#include <atomic>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

using json = nlohmann::json;

struct Fixture {
    std::string id, kind;
    Vector3 pos, aim;                 // scene coords (z-up), metres
    float beamDeg = 15.f;
    int universe = 1, address = 1;
    std::vector<std::string> channels;
    std::vector<std::vector<int>> offsets;
};

// ---- shared DMX state (written by the receive thread) ----------------------
static std::mutex g_mtx;
static std::map<int, std::array<uint8_t, 512>> g_uni;
static std::atomic<bool> g_run{true};
static std::atomic<long> g_pkts{0};

// ---- sACN (E1.31) receiver -------------------------------------------------
static void sacnLoop(int port) {
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    int yes = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = INADDR_ANY;
    a.sin_port = htons(port);
    if (bind(s, (sockaddr *)&a, sizeof(a)) < 0) { close(s); return; }
    timeval tv{1, 0};
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    uint8_t buf[1024];
    while (g_run.load()) {
        ssize_t n = recv(s, buf, sizeof(buf), 0);
        if (n < 126) continue;                                   // too short for E1.31
        if (memcmp(buf + 4, "ASC-E1.17\0\0\0", 12) != 0) continue; // not sACN
        if (buf[125] != 0) continue;                             // DMX start code must be 0
        int uni = (buf[113] << 8) | buf[114];
        int slots = ((buf[123] << 8) | buf[124]) - 1;            // property count minus start code
        if (slots < 0) slots = 0;
        if (slots > 512) slots = 512;
        std::lock_guard<std::mutex> lk(g_mtx);
        auto &d = g_uni[uni];
        for (int i = 0; i < slots && (126 + i) < n; i++) d[i] = buf[126 + i];
        g_pkts++;
    }
    close(s);
}

// ---- DMX -> value helpers --------------------------------------------------
static int chanIdx(const Fixture &f, const char *prefix) {
    for (size_t i = 0; i < f.channels.size(); i++) {
        std::string a = f.channels[i];
        for (auto &c : a) c = (char)tolower(c);
        if (a.rfind(prefix, 0) == 0) return (int)i;              // startswith
    }
    return -1;
}
// normalised 0..1 for channel index i, reading its DMX slot(s) from `d`
static float chanVal(const Fixture &f, const std::array<uint8_t, 512> &d, int i) {
    if (i < 0) return -1.f;
    const auto &offs = f.offsets[i];
    int base = f.address - 1;                                    // 0-based
    int hiIx = base + offs[0] - 1;
    if (hiIx < 0 || hiIx > 511) return 0.f;
    if (offs.size() >= 2) {
        int loIx = base + offs[1] - 1;
        int w = (d[hiIx] << 8) | (loIx >= 0 && loIx <= 511 ? d[loIx] : 0);
        return w / 65535.f;
    }
    return d[hiIx] / 255.f;
}

static Vector3 ry(Vector3 v) { return {v.x, v.z, v.y}; }         // z-up scene -> y-up raylib

int main(int argc, char **argv) {
    std::string scenePath = "cache/scene.json";
    for (int i = 1; i < argc; i++) if (argv[i][0] != '-') scenePath = argv[i];

    json j;
    { FILE *fp = fopen(scenePath.c_str(), "rb");
      if (!fp) { TraceLog(LOG_ERROR, "cannot open %s", scenePath.c_str()); return 1; }
      std::string s; char b[4096]; size_t r; while ((r = fread(b, 1, sizeof(b), fp))) s.append(b, r);
      fclose(fp); j = json::parse(s, nullptr, false);
      if (j.is_discarded()) { TraceLog(LOG_ERROR, "bad scene.json"); return 1; } }

    std::vector<Fixture> fixtures;
    for (auto &f : j["fixtures"]) {
        Fixture x;
        x.id = f.value("id", "");
        x.kind = f.value("kind", "fixture");
        auto p = f["pos"], a = f["aim"];
        x.pos = {p[0].get<float>(), p[1].get<float>(), p[2].get<float>()};
        x.aim = {a[0].get<float>(), a[1].get<float>(), a[2].get<float>()};
        x.beamDeg = f.value("beam_deg", 15.0);
        x.universe = f.value("universe", 1);
        x.address = f.value("address", 1);
        for (auto &c : f["channels"]) x.channels.push_back(c.get<std::string>());
        for (auto &o : f["offsets"]) { std::vector<int> v; for (auto &k : o) v.push_back(k.get<int>()); x.offsets.push_back(v); }
        fixtures.push_back(std::move(x));
    }
    TraceLog(LOG_INFO, "loaded %d fixtures from %s", (int)fixtures.size(), scenePath.c_str());

    std::thread rx(sacnLoop, 5568);

    InitWindow(1280, 760, "Limelight sim");
    SetTargetFPS(60);
    Camera3D cam{};
    cam.position = {4.0f, 2.2f, -6.0f};      // front, slightly up (raylib y-up)
    cam.target = {4.0f, 1.6f, 3.0f};
    cam.up = {0, 1, 0};
    cam.fovy = 55;
    cam.projection = CAMERA_PERSPECTIVE;

    while (!WindowShouldClose()) {
        if (IsMouseButtonDown(MOUSE_BUTTON_RIGHT)) UpdateCamera(&cam, CAMERA_THIRD_PERSON);

        std::map<int, std::array<uint8_t, 512>> snap;
        { std::lock_guard<std::mutex> lk(g_mtx); snap = g_uni; }

        BeginDrawing();
        ClearBackground({8, 8, 12, 255});
        BeginMode3D(cam);
        // room floor grid (8 x 6 m)
        for (int gx = 0; gx <= 8; gx++) DrawLine3D(ry({(float)gx, 0, 0}), ry({(float)gx, 6, 0}), {40, 40, 48, 255});
        for (int gy = 0; gy <= 6; gy++) DrawLine3D(ry({0, (float)gy, 0}), ry({8, (float)gy, 0}), {40, 40, 48, 255});

        for (auto &f : fixtures) {
            static const std::array<uint8_t, 512> zero{};
            auto it = snap.find(f.universe);
            const auto &d = (it != snap.end()) ? it->second : zero;

            float dim = chanVal(f, d, chanIdx(f, "dimmer")); if (dim < 0) dim = 0;
            float r = chanVal(f, d, chanIdx(f, "coloradd_r"));
            float g = chanVal(f, d, chanIdx(f, "coloradd_g"));
            float b = chanVal(f, d, chanIdx(f, "coloradd_b"));
            bool hasColor = (r >= 0 || g >= 0 || b >= 0);
            Color col = hasColor ? Color{(uint8_t)(fmaxf(0, r) * 255), (uint8_t)(fmaxf(0, g) * 255), (uint8_t)(fmaxf(0, b) * 255), 255}
                                 : Color{255, 245, 230, 255};       // white for dimmer-only

            // beam direction
            int pi = chanIdx(f, "pan"), ti = chanIdx(f, "tilt");
            Vector3 dir;
            if (pi >= 0 && ti >= 0) {                                // mover: aim from pan/tilt
                float pan = chanVal(f, d, pi), tilt = chanVal(f, d, ti);
                float panA = (pan - 0.5f) * (270.0f * DEG2RAD * 2);  // +/-270 deg
                float tiltA = (tilt - 0.5f) * (135.0f * DEG2RAD * 2);// +/-135 from horizontal
                Vector3 down = {0, 0, -1};
                Vector3 v = Vector3RotateByAxisAngle(down, {1, 0, 0}, tiltA);
                dir = Vector3RotateByAxisAngle(v, {0, 0, 1}, panA);
            } else {
                dir = Vector3Normalize(Vector3Subtract(f.aim, f.pos));
                if (Vector3Length(dir) < 0.01f) dir = {0, 0, -1};
            }

            // body
            DrawCube(ry(f.pos), 0.18f, 0.18f, 0.18f, {30, 30, 36, 255});

            // beam cone (additive), length to floor-ish, radius from beam angle
            float len = (pi >= 0) ? 6.0f : fmaxf(1.0f, Vector3Distance(f.pos, f.aim));
            Vector3 endS = Vector3Add(f.pos, Vector3Scale(dir, len));
            float endR = len * tanf(f.beamDeg * 0.5f * DEG2RAD);
            uint8_t a = (uint8_t)(fmaxf(0, dim) * 200);
            if (a > 4) {
                BeginBlendMode(BLEND_ADDITIVE);
                DrawCylinderEx(ry(f.pos), ry(endS), 0.03f, endR, 18, {col.r, col.g, col.b, a});
                EndBlendMode();
            }
        }
        EndMode3D();

        DrawText(TextFormat("fixtures: %d   sACN pkts: %ld   [hold RMB to orbit]",
                            (int)fixtures.size(), g_pkts.load()), 12, 12, 18, {180, 180, 190, 255});
        EndDrawing();
    }

    g_run = false;
    CloseWindow();
    rx.join();
    return 0;
}
