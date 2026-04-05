cmake_minimum_required(VERSION 3.16)
project(deepgram-captions C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(FetchContent)

# ── libwebsockets — WebSocket client for streaming audio to Deepgram ─────
find_package(Libwebsockets QUIET)
if(NOT Libwebsockets_FOUND)
  FetchContent_Declare(
    libwebsockets
    GIT_REPOSITORY https://github.com/warmcat/libwebsockets.git
    GIT_TAG        v4.3.3
  )
  set(LWS_WITH_SSL ON CACHE BOOL "" FORCE)
  set(LWS_WITHOUT_TESTAPPS ON CACHE BOOL "" FORCE)
  set(LWS_WITHOUT_TEST_SERVER ON CACHE BOOL "" FORCE)
  set(LWS_WITHOUT_TEST_PING ON CACHE BOOL "" FORCE)
  set(LWS_WITHOUT_TEST_CLIENT ON CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(libwebsockets)
endif()

# ── OBS Studio SDK — find via pkg-config or OBS_DIR cmake var ────────────
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
  pkg_check_modules(OBS QUIET libobs)
endif()

if(NOT OBS_FOUND)
  if(DEFINED ENV{OBS_DIR})
    set(OBS_DIR "$ENV{OBS_DIR}")
  elseif(NOT OBS_DIR)
    message(WARNING "OBS SDK not found. Set -DOBS_DIR=<path-to-obs-studio>")
  endif()

  if(OBS_DIR)
    set(OBS_INCLUDE_DIRS "${OBS_DIR}/libobs")
    find_library(OBS_LIBRARIES NAMES obs libobs PATHS "${OBS_DIR}/build/libobs" NO_DEFAULT_PATH)
  endif()
endif()

# ── Plugin shared library ────────────────────────────────────────────────
add_library(deepgram-captions MODULE deepgram-caption-plugin.c)

target_include_directories(deepgram-captions PRIVATE ${OBS_INCLUDE_DIRS})
target_link_libraries(deepgram-captions PRIVATE websockets ${OBS_LIBRARIES} pthread)

set_target_properties(deepgram-captions PROPERTIES PREFIX "")
if(APPLE)
  set_target_properties(deepgram-captions PROPERTIES SUFFIX ".so")
endif()
