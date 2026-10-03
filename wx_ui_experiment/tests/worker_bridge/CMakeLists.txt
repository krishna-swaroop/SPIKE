# SPDX-License-Identifier: Apache-2.0
cmake_minimum_required(VERSION 3.24)
project(spike_worker_bridge_tests LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(wxWidgets CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)

add_executable(worker-bridge-harness
    worker_bridge_harness.cpp
    ../../src/worker_bridge.cpp)
target_include_directories(worker-bridge-harness PRIVATE ../../include)
target_compile_definitions(worker-bridge-harness PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(worker-bridge-harness PRIVATE
    wx::base wx::core nlohmann_json::nlohmann_json)
if(MSVC)
    target_compile_options(worker-bridge-harness PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()

enable_testing()
add_test(
    NAME worker-bridge-recovery
    COMMAND worker-bridge-harness
        "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/fake_worker.py")
