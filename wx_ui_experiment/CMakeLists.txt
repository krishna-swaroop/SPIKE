cmake_minimum_required(VERSION 3.24)
project(spike_wx_ui_experiment VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(wxWidgets REQUIRED COMPONENTS base core gl)
include(${wxWidgets_USE_FILE})
find_package(nlohmann_json CONFIG REQUIRED)
find_package(VTK CONFIG REQUIRED COMPONENTS
    CommonCore CommonDataModel FiltersCore FiltersSources
    RenderingCore RenderingOpenGL2)

add_executable(spike-wx-ui-experiment WIN32
    src/main.cpp
    src/ui_shell.cpp
    src/ui_managers.cpp
    src/project_actions.cpp
    src/search_dialog.cpp
    src/flat_button.cpp
    src/flat_choice.cpp
    src/vtk_canvas.cpp
    src/worker_bridge.cpp)
target_sources(spike-wx-ui-experiment PRIVATE src/project_session.cpp)
target_include_directories(spike-wx-ui-experiment PRIVATE include)
target_compile_definitions(spike-wx-ui-experiment PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_link_libraries(spike-wx-ui-experiment PRIVATE
    ${wxWidgets_LIBRARIES} nlohmann_json::nlohmann_json ${VTK_LIBRARIES})
if(MSVC)
    target_compile_options(spike-wx-ui-experiment PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()
vtk_module_autoinit(TARGETS spike-wx-ui-experiment MODULES ${VTK_LIBRARIES})

add_custom_command(TARGET spike-wx-ui-experiment POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/ui_manifest.json"
        "$<TARGET_FILE_DIR:spike-wx-ui-experiment>/ui_manifest.json"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/assets"
        "$<TARGET_FILE_DIR:spike-wx-ui-experiment>/assets")

include(CTest)
if(BUILD_TESTING)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../.venv/Scripts/python.exe")
        set(Python3_EXECUTABLE "${CMAKE_CURRENT_SOURCE_DIR}/../.venv/Scripts/python.exe")
    endif()
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    add_executable(project-session-test tests/project_session_test.cpp src/project_session.cpp)
    target_include_directories(project-session-test PRIVATE include)
    target_link_libraries(project-session-test PRIVATE nlohmann_json::nlohmann_json)
    add_test(NAME project-session-contract COMMAND project-session-test)
    add_executable(worker-bridge-harness tests/worker_bridge/worker_bridge_harness.cpp src/worker_bridge.cpp)
    target_include_directories(worker-bridge-harness PRIVATE include)
    target_compile_definitions(worker-bridge-harness PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(worker-bridge-harness PRIVATE ${wxWidgets_LIBRARIES} nlohmann_json::nlohmann_json)
    add_test(NAME worker-bridge-recovery COMMAND worker-bridge-harness
        "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/worker_bridge/fake_worker.py")
    add_test(NAME project-session-worker-roundtrip COMMAND "${Python3_EXECUTABLE}"
        -m unittest wx_ui_experiment.tests.project_session_worker_roundtrip)
    set_tests_properties(project-session-worker-roundtrip PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/..")
    add_test(NAME canonical-worker-adapter COMMAND "${Python3_EXECUTABLE}"
        -m unittest wx_ui_experiment.tests.worker_adapter_test)
    set_tests_properties(canonical-worker-adapter PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/..")
endif()
