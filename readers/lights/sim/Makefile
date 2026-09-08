RAYLIB := vendor/raylib/build/raylib
CXXFLAGS := -std=c++17 -O2 -Wall
INCLUDES := -I$(RAYLIB)/include -Ivendor/raylib/src
LIBS := $(RAYLIB)/libraylib.a -lGL -lm -lpthread -ldl -lrt -lX11

sim: sim.cpp vendor/json.hpp $(RAYLIB)/libraylib.a
	g++ $(CXXFLAGS) sim.cpp -o sim $(INCLUDES) $(LIBS)

# one-time: fetch + build raylib locally (no sudo, no system install)
raylib:
	git clone --depth 1 https://github.com/raysan5/raylib.git vendor/raylib
	cmake -S vendor/raylib -B vendor/raylib/build -DBUILD_EXAMPLES=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
	cmake --build vendor/raylib/build -j2

# turn an MVR into cache/scene.json + models, then build
scene:
	python3 gen_scene.py ../mvr/out/club.mvr cache

clean:
	rm -f sim

.PHONY: raylib scene clean
